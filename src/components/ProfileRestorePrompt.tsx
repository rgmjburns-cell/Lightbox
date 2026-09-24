import type { ServerPlayerProfile } from "~/lib/profile";

interface ProfileRestorePromptProps {
  /** The profile the server found for the typed nickname. */
  profile: ServerPlayerProfile;
  /** "That's me" — adopt this profile (name, totals, bests, badges). */
  onRestore: () => void;
  /** "Start fresh" — keep playing as a new player with the same nickname. */
  onFresh: () => void;
  busy?: boolean;
  /** Headline above the card (the two call sites word it differently). */
  title?: string;
}

/**
 * Shown when a player types a nickname on a device that has no player id and
 * the server finds exactly ONE profile with that name — the installed-PWA case,
 * where local storage started empty.
 *
 * The player decides, and only their tap adopts the profile: two people who
 * share a nickname are never merged behind anyone's back (if the server finds
 * more than one profile for the name it does not offer this prompt at all).
 */
export default function ProfileRestorePrompt({
  profile,
  onRestore,
  onFresh,
  busy = false,
  title = "Welcome back?",
}: ProfileRestorePromptProps) {
  const badgeCount = profile.badges.length;
  return (
    <div className="w-full rounded-xl bg-white/10 border border-white/20 p-4 text-left">
      <p className="text-white font-bold" style={{ fontSize: "clamp(0.8rem, 1.8vh, 1rem)" }}>
        {title}
      </p>
      <p
        className="text-white/70 mt-1"
        style={{ fontSize: "clamp(0.65rem, 1.5vh, 0.8rem)", lineHeight: 1.5 }}
      >
        A player using the nickname{" "}
        <span className="font-semibold text-white">{profile.name}</span> already
        has {profile.monthlyTotal.toLocaleString()} points this month
        {badgeCount > 0 ? ` and ${badgeCount.toLocaleString()} badge${badgeCount === 1 ? "" : "s"}` : ""}.
        Is that you?
      </p>
      <div className="flex gap-2 mt-3">
        <button
          type="button"
          disabled={busy}
          onClick={onRestore}
          className="flex-1 bg-[#008C95] text-white font-bold rounded-lg border-none disabled:opacity-50"
          style={{ padding: "clamp(7px, 1.3vh, 10px)", fontSize: "clamp(0.7rem, 1.6vh, 0.85rem)" }}
        >
          {busy ? "Restoring…" : "Yes, that's me"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onFresh}
          className="flex-1 bg-white/15 text-white font-semibold rounded-lg border border-white/25 disabled:opacity-50"
          style={{ padding: "clamp(7px, 1.3vh, 10px)", fontSize: "clamp(0.7rem, 1.6vh, 0.85rem)" }}
        >
          I'm new
        </button>
      </div>
    </div>
  );
}
