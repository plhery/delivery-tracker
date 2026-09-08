# Friends

Friends is a small, private stamp collection shared by mutual invitation. It has no public profiles, discovery, address-book access, follower counts, purchase leaderboard, or delivery feed.

Joining is opt-in. A person chooses a nickname and sees exactly what will be shared before saving. Passport statistics (delivered count, average journey rounded up to whole days, four earned Passport stamps) can be hidden independently. A coarse “a parcel arrived this week” signal has its own switch, off by default. It exposes neither a parcel nor an exact time. No parcel contents or labels, tracking numbers, carriers, locations, emails, Google photos, active shipments, or parcel identifiers cross the Friends boundary.

A single-use invitation code expires after seven days; creating a new code invalidates the old one. Codes travel only in request bodies and are stored as SHA-256 hashes. Opening a code previews only the chosen nickname; acceptance is explicit and requires an opted-in account. Either friend can remove the connection. Disabling Friends deletes the profile, invitations, and both sides of every friendship. Account deletion cascades through these records too.

The database computes allowlisted summaries directly from owned tracking events. Client-supplied statistics are never accepted. All friend tables deny direct client access; authenticated database functions bind the caller with `auth.uid()` and project only mutual friends. Raw parcel RLS stays unchanged. Friend data uses network-only APIs, has no persistent client cache, and is cleared when the app backgrounds or the view closes. A visible view refreshes every 60 seconds so privacy changes propagate. The account export includes only the owner’s sharing preferences and their connections (nickname and public card ID), not other people’s statistics.

Demo friends are clearly fictional, local fixtures using the same response contract. Their actions never reach another person. Strings and response types are shared by web and iOS. Reduced Motion, keyboard access, VoiceOver, dark appearance, and narrow screens follow the existing UI system.

Rollout: apply `20260909000000_private_friends.sql` before releasing the clients. Run `supabase/tests/friends.sql` on a disposable database along with the existing RLS suite. The UI reports an unavailable service if the backend is unreachable; it never fills a real account with demo friends.
