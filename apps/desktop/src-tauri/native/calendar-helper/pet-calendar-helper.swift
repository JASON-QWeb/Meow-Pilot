import EventKit
import Foundation

struct CalendarEvent: Encodable {
    let id: String
    let title: String
    let start: String
    let end: String
    let location: String?
    let notes: String?
    let calendar: String
    let allDay: Bool
}

struct CalendarPayload: Encodable {
    let source: String
    let available: Bool
    let authorizationStatus: String
    let range: CalendarRange?
    let events: [CalendarEvent]
    let error: String?
    let summary: String
}

struct CalendarRange: Encodable {
    let start: String
    let end: String
}

let arguments = CommandLine.arguments
if arguments.contains("--probe") {
    writeJson(CalendarPayload(
        source: "eventkit",
        available: true,
        authorizationStatus: authorizationStatusName(),
        range: nil,
        events: [],
        error: nil,
        summary: "EventKit helper ready."
    ))
    exit(0)
}

let start = parseDate(argument("--start")) ?? Calendar.current.startOfDay(for: Date())
let end = parseDate(argument("--end")) ?? Calendar.current.date(byAdding: .day, value: 1, to: start) ?? Date()
let range = CalendarRange(start: isoString(start), end: isoString(end))
let store = EKEventStore()

requestCalendarAccess(store) { granted, error in
    guard granted else {
        writeJson(CalendarPayload(
            source: "eventkit",
            available: false,
            authorizationStatus: authorizationStatusName(),
            range: range,
            events: [],
            error: error?.localizedDescription,
            summary: "没有 macOS 日历访问权限。请在系统设置中允许 Pet Agent 访问日历。"
        ))
        exit(0)
    }

    let predicate = store.predicateForEvents(withStart: start, end: end, calendars: nil)
    let events = store.events(matching: predicate)
        .sorted { $0.startDate < $1.startDate }
        .map { event in
            CalendarEvent(
                id: event.eventIdentifier ?? "\(event.calendar.calendarIdentifier)-\(event.startDate.timeIntervalSince1970)",
                title: event.title ?? "未命名日程",
                start: isoString(event.startDate),
                end: isoString(event.endDate),
                location: emptyToNil(event.location),
                notes: emptyToNil(event.notes).map { String($0.prefix(500)) },
                calendar: event.calendar.title,
                allDay: event.isAllDay
            )
        }

    writeJson(CalendarPayload(
        source: "eventkit",
        available: true,
        authorizationStatus: authorizationStatusName(),
        range: range,
        events: events,
        error: nil,
        summary: events.isEmpty ? "当前时间范围内没有日程。" : "读取到 \(events.count) 个日程。"
    ))
    exit(0)
}

RunLoop.current.run()

func requestCalendarAccess(_ store: EKEventStore, completion: @escaping (Bool, Error?) -> Void) {
    if #available(macOS 14.0, *) {
        store.requestFullAccessToEvents(completion: completion)
    } else {
        store.requestAccess(to: .event, completion: completion)
    }
}

func argument(_ name: String) -> String? {
    guard let index = arguments.firstIndex(of: name), arguments.indices.contains(index + 1) else {
        return nil
    }
    return arguments[index + 1]
}

func parseDate(_ value: String?) -> Date? {
    guard let value else { return nil }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: value) {
        return date
    }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: value)
}

func isoString(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
}

func authorizationStatusName() -> String {
    let status = EKEventStore.authorizationStatus(for: .event)
    if #available(macOS 14.0, *) {
        switch status {
        case .fullAccess:
            return "fullAccess"
        case .writeOnly:
            return "writeOnly"
        default:
            break
        }
    }

    switch status {
    case .notDetermined:
        return "notDetermined"
    case .restricted:
        return "restricted"
    case .denied:
        return "denied"
    case .authorized:
        return "authorized"
    case .fullAccess:
        return "fullAccess"
    case .writeOnly:
        return "writeOnly"
    @unknown default:
        return "unknown(\(status.rawValue))"
    }
}

func emptyToNil(_ value: String?) -> String? {
    guard let value else { return nil }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
}

func writeJson<T: Encodable>(_ payload: T) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    do {
        let data = try encoder.encode(payload)
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write("\n".data(using: .utf8)!)
    } catch {
        let fallback = #"{"source":"eventkit","available":false,"events":[],"summary":"日历结果编码失败。"}"#
        FileHandle.standardOutput.write(fallback.data(using: .utf8)!)
        FileHandle.standardOutput.write("\n".data(using: .utf8)!)
    }
}
