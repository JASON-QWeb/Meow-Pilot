import { useState } from "react";
import { Check, RefreshCw, UserPlus } from "lucide-react";
import type { AccountProfile, FriendSummary, Memory, ProviderSummary, SkillSummary, SocialExchangeRecord } from "@pet/protocol";

type RuntimeSidePanelProps = {
  memories: Memory[];
  memoryProposal: Memory | null;
  skills: SkillSummary[];
  providers: ProviderSummary[];
  account: AccountProfile | null;
  friends: FriendSummary[];
  latestExchange: SocialExchangeRecord | null;
  onCommitMemory: () => void | Promise<void>;
  onRejectMemory: () => void | Promise<void>;
  onRunSkill: (name: string) => void | Promise<void>;
  onSignIn: (displayName: string) => void | Promise<void>;
  onAddFriend: (handle: string) => void | Promise<void>;
  onExchangeFriend: (friendId: string) => void | Promise<void>;
};

export function RuntimeSidePanel({
  memories,
  memoryProposal,
  skills,
  providers,
  account,
  friends,
  latestExchange,
  onCommitMemory,
  onRejectMemory,
  onRunSkill,
  onSignIn,
  onAddFriend,
  onExchangeFriend,
}: RuntimeSidePanelProps) {
  const [displayName, setDisplayName] = useState("");
  const [friendHandle, setFriendHandle] = useState("");

  const submitSignIn = async () => {
    const value = displayName.trim();
    if (!value) return;
    await onSignIn(value);
    setDisplayName("");
  };

  const submitFriend = async () => {
    const value = friendHandle.trim();
    if (!value) return;
    await onAddFriend(value);
    setFriendHandle("");
  };

  return (
    <aside className="sidePanel" aria-label="Runtime data">
      {memoryProposal ? (
        <section className="proposal">
          <div className="sideTitle">
            <Check size={16} />
            <span>Memory proposal</span>
          </div>
          <p>{memoryProposal.content}</p>
          <div className="buttonRow">
            <button type="button" onClick={() => void onCommitMemory()}>
              Save
            </button>
            <button type="button" onClick={() => void onRejectMemory()}>
              Ignore
            </button>
          </div>
        </section>
      ) : null}

      <section className="runtimeList">
        <div className="sideTitle">
          <UserPlus size={16} />
          <span>Account</span>
        </div>
        {account ? (
          <article className="runtimeCard compact">
            <strong>{account.displayName}</strong>
            <p>@{account.handle}</p>
          </article>
        ) : (
          <div className="inlineForm">
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Display name" />
            <button type="button" onClick={() => void submitSignIn()}>
              Sign in
            </button>
          </div>
        )}
      </section>

      <section className="runtimeList">
        <div className="sideTitle">
          <RefreshCw size={16} />
          <span>Friends</span>
        </div>
        <div className="inlineForm">
          <input value={friendHandle} onChange={(event) => setFriendHandle(event.target.value)} placeholder="@friend" />
          <button type="button" onClick={() => void submitFriend()}>
            Add
          </button>
        </div>
        <div className="runtimeItems">
          {friends.slice(0, 3).map((friend) => (
            <article className="runtimeCard compact" key={friend.id}>
              <strong>{friend.displayName}</strong>
              <p>{friend.lastExchangeAt ? `last exchange ${new Date(friend.lastExchangeAt).toLocaleDateString()}` : `@${friend.handle}`}</p>
              <button type="button" onClick={() => void onExchangeFriend(friend.id)}>
                Exchange
              </button>
            </article>
          ))}
          {latestExchange ? (
            <article className="runtimeCard compact">
              <strong>Latest exchange</strong>
              <p>{latestExchange.summary}</p>
            </article>
          ) : null}
        </div>
      </section>

      <RuntimeList title="Memory" items={memories.map((memory) => ({ title: memory.kind, body: memory.content }))} />
      <RuntimeList title="Skills" items={skills.map((skill) => ({ title: skill.name, body: skill.description, action: () => onRunSkill(skill.name) }))} />
      <RuntimeList
        title="Providers"
        items={providers.map((provider) => ({
          title: provider.label,
          body: provider.configured ? `${provider.mode}${provider.model ? ` · ${provider.model}` : ""}${provider.source ? ` · ${provider.source}` : ""}` : `${provider.mode} not configured`,
        }))}
      />
    </aside>
  );
}

function RuntimeList({ title, items }: { title: string; items: Array<{ title: string; body: string; action?: () => void | Promise<void> }> }) {
  return (
    <section className="runtimeList">
      <div className="sideTitle">
        <span>{title}</span>
      </div>
      <div className="runtimeItems">
        {items.slice(0, 4).map((item) => (
          <article className="runtimeCard" key={`${title}-${item.title}-${item.body}`}>
            <strong>{item.title}</strong>
            <p>{item.body}</p>
            {item.action ? (
              <button type="button" onClick={() => void item.action?.()}>
                Run
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
