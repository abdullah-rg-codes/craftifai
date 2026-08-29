# Phase 4 — Web application (Agent mode)

---

Backend invariants hold. Build the web interface.

The brief says the frontend does not need to be visually elaborate, and I am taking it at
its word. Clean, consistent, legible, and correct in its states. I would rather have
every failure state handled plainly than have a beautiful dashboard that shows a blank
screen when the model times out. Do not spend effort on visual flourish.

**Administrator screens.** Organization overview, credit balance, team member management
with the full lifecycle, credit purchase initiation, credit transaction history, model
configuration, model connection test, organization usage history, audit event history.

**Member screens.** AI request playground, personal usage history. No administrative
surface at all.

**Every list is paginated** against the cursor APIs. No endpoint returns an unbounded
collection, and no screen fetches everything and paginates client-side.

**Every view handles four states:** loading, empty, error, and populated. The empty
states get real copy explaining what the user can do — a member who has never run a
request should see something useful, not an empty table. No lorem ipsum anywhere and no
placeholder text.

**The error messages that matter.** Insufficient credits tells the member how many
credits the request needed and what the organization has, and tells an administrator how
to buy more. A model failure distinguishes a timeout from a rate limit from a
configuration problem, because a member who cannot tell those apart files the same
useless ticket for all three. Neither message ever exposes the endpoint or the
credential.

**Authorization in the UI is for user experience only.** Hiding an administrative control
from a member is a courtesy; the server already refuses. Do not add a client-side check
that the server does not also enforce, and do not remove a server check because the
client hides the control.

**The model credential never reaches the browser.** Not in a form value, not in a
prefilled input, not in a hydration payload, not in a network response the user could
open developer tools and read. The configuration form writes the credential and displays
only whether one is set and when it was last changed.

Run it, tell me the URL, and give me the click path for the administrator flow and the
member flow. Then stop.
