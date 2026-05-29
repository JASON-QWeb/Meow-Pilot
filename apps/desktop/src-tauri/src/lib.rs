use tauri::Manager;
use std::fs::create_dir_all;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

struct AgentProcess(Mutex<Option<Child>>);

const AGENTD_LABEL: &str = "ai.petagent.desktop.agentd";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let agent = start_agent_runtime(app.handle());
            app.manage(AgentProcess(Mutex::new(agent)));

            if let Some(window) = app.get_webview_window("pet") {
                let _ = window.set_always_on_top(true);
                let _ = window.set_skip_taskbar(true);
            }

            if let Some(window) = app.get_webview_window("work") {
                let work = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = work.hide();
                    }
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "pet" {
                if let tauri::WindowEvent::Destroyed = event {
                    if let Some(state) = window.try_state::<AgentProcess>() {
                        if let Ok(mut child) = state.0.lock() {
                            if let Some(mut process) = child.take() {
                                let _ = process.kill();
                            }
                        }
                    }
                    stop_launchd_agent();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running pet desktop shell");
}

fn start_agent_runtime(app: &tauri::AppHandle) -> Option<Child> {
    stop_launchd_agent();

    if cfg!(debug_assertions) {
        let cwd = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("..");
        return Command::new("pnpm")
            .args(["--filter", "@pet/agent-runtime", "dev"])
            .current_dir(cwd)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .ok();
    }

    let resource_dir = app.path().resource_dir().ok()?;
    let server = find_agent_server(&resource_dir)?;
    let data_dir = app.path().app_data_dir().ok()?;
    create_dir_all(&data_dir).ok()?;
    let pet_data_dir = data_dir.join(".pet");
    create_dir_all(&pet_data_dir).ok()?;
    let log_path = data_dir.join("agent-runtime.log");
    let script = format!(
        "cd {} && PET_AGENTD_HOST='127.0.0.1' PET_AGENTD_PORT='4747' PET_AGENTD_DB={} PET_AI_CONFIG_PATH={} exec {} --no-experimental-detect-module {} >>{} 2>&1",
        shell_quote(&data_dir),
        shell_quote(&pet_data_dir.join("pet-agentd.sqlite")),
        shell_quote(&pet_data_dir.join("ai-provider.json")),
        shell_quote(&node_binary()),
        shell_quote(&server),
        shell_quote(&log_path)
    );

    let _ = Command::new("launchctl")
        .args(["submit", "-l", AGENTD_LABEL, "--", "/bin/zsh", "-lc", &script])
        .current_dir(&data_dir)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    None
}

fn stop_launchd_agent() {
    let _ = Command::new("launchctl")
        .args(["remove", AGENTD_LABEL])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

fn node_binary() -> PathBuf {
    for candidate in ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"] {
        let path = PathBuf::from(candidate);
        if path.exists() {
            return path;
        }
    }
    PathBuf::from("node")
}

fn shell_quote(path: &PathBuf) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"))
}

fn find_agent_server(resource_dir: &PathBuf) -> Option<PathBuf> {
    let direct = resource_dir.join("agent-runtime").join("dist").join("server.cjs");
    if direct.exists() {
        return Some(direct);
    }

    let mut stack = vec![resource_dir.clone()];
    while let Some(path) = stack.pop() {
        let entries = std::fs::read_dir(path).ok()?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            if path.file_name().and_then(|name| name.to_str()) == Some("server.cjs") {
                return Some(path);
            }
        }
    }
    None
}
