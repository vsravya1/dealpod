# Three-minute demo: two stories only



Target recording length: about 2 minutes 50 seconds. Show cancellation, waitlist and failure handling only in supporting screenshots.



## Prepared data

Run `npm run demo` and open http://localhost:3001/. The rehearsal catalog has nine Study, Everyday, and Work Laptop variants. Northstar reserves a 32 GB RAM / 1 TB SSD Work Laptop at $649 per buyer for requests.

## Story 1: happy path — Mia and Sam



Use Study Laptop, Deal ID `study-8-512`. It starts at 0/2 and costs $489 per buyer.



1. Mia describes a study laptop under $550, 8 GB RAM and 512 GB storage. Confirm the search, review the fresh group, accept its terms and join.

2. Sam joins that same fresh group. It reaches 2/2 and starts its shared payment window.

3. Each buyer approves PayPal sandbox checkout. Show one checkout in the video; edit out the repeated checkout while keeping the final two-payment result truthful.

4. Everyday Electronics sees 2/2 buyer payments, enters a separate sandbox test tracking number and carrier for each buyer, processes the group shipment, and Mia sees Shipped with tracking submitted to PayPal sandbox. Use synthetic tracking only; no carrier booking takes place.



## Story 2: unmet demand — Noah and Priya



The public catalog tops out at 16 GB RAM. The 32 GB configuration is reserved in Northstar inventory for agent-prepared proposals.



Noah prompt: I need a laptop with at least 32 GB RAM and 1024 GB SSD. My budget is $700. Ship to the US.



Priya prompt: I need a work laptop with at least 32 GB RAM and 1024 GB SSD. My budget is $680. Ship to the US.



1. Each confirms the request. The public catalog has no 32 GB match, so each shares an unmet request.

2. For automatic joining, each explicitly enables auto-join, selects Northstar Computing, accepts its displayed terms and 24-hour payment window, and authorizes a maximum group size of 2. No timing guarantees are requested.

3. The background worker pools these two compatible buyers, uses Northstar's authorized quantity price and runs a seller AI assessment plus a separate buyer AI assessment for each participant.

4. Northstar reviews combined demand and approves one shared proposal.

5. Noah and Priya are automatically committed within their permissions. Show 2/2 and the still-manual PayPal payment control. End this story here; checkout has already been demonstrated.



Agents run while the server is running. Real AI calls take time; edit the waiting period rather than inventing progress. If a condition or seller term differs, automatic joining pauses for review.



## Suggested pacing



- 0:00–0:10: problem and storefront.

- 0:10–1:15: happy path through payment and shipment.

- 1:15–2:40: unmet demand, shared proposal, seller approval and authorized joining.

- 2:40–2:50: buyer control, PayPal payment and closing value statement.


## Additional practice deals

Stop the server and run `npm run demo -- --new-deals` to add another batch of nine open groups. Normal restarts preserve rehearsal progress.

## Reset rehearsal activity

Stop the local app with Ctrl+C, then run `npm run demo:reset` and `npm run demo`. The reset targets only data/rehearsal.sqlite and creates a standalone SQLite backup first. It clears saved requests, conversations, demand proposals, authorizations, commitments, waitlists, payments, shipments, seller drafts and activity. Buyer profiles, existing deal definitions and seller stock/pricing rules remain. Published agent-created deals are closed and their allocated units returned to agent inventory once, so they do not satisfy the next unmet-demand rehearsal. Practice deal closing times receive a fresh seven-day window; original catalog deadlines remain unchanged. The command refuses to run while ports 3000, 3001 or configured PORT are listening. It does not call PayPal or modify sandbox transaction history. Refresh all browser tabs after restarting.

Use `npm run demo:reset -- --new-catalog` to also replace the catalog and reseed all three sellers’ stock and pricing rules. This backs up the rehearsal database before replacing it.
