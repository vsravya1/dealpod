# DealPod

DealPod helps people who want similar products buy together at a group price. Buyers can join an existing deal, ask sellers for a deal that fits, or save an interest and get an alert when a match appears. Each buyer approves their own PayPal payment once the group is ready.

Built for the PayPal AI Hackathon 2026. The demo uses a laptop catalog, switchable buyer and seller profiles, and PayPal Sandbox.

- [Demo presentation](Demo/DealPod%20Demo.pptx)
- [Step-by-step demo walkthrough](DEMO.md)
- [Architecture and agent handoffs](ARCHITECTURE.md)

## Run locally

1. Install **Node.js 24 or later**.
2. Download this repository using **Code → Download ZIP**, extract it, and open a terminal in the folder containing `package.json`.
3. For the full AI and PayPal demo, copy `.env.example` to `.env` in that folder. Fill in `OPENAI_API_KEY`, `PAYPAL_CLIENT_ID`, and `PAYPAL_CLIENT_SECRET` with your own credentials. Keep `PAYPAL_ENV=sandbox`. Use a personal PayPal Sandbox buyer account to approve checkout.
4. Start the demo.

   ```sh
   npm run demo
   ```

5. Open [http://localhost:3001](http://localhost:3001). Use the buyer and seller dropdowns to switch demo profiles.

The app uses Node’s built-in SQLite support and creates its local demo database on startup. There are no npm dependencies to install. You can explore the storefront and group flow without credentials. Live AI assessments require an OpenAI key, and PayPal Sandbox checkout requires sandbox credentials.

## What to try

### 1. Join an existing group deal

Open the **Mia** and **Sam** buyer profiles in separate tabs. Join the same **Study Laptop** deal with **8 GB RAM and 512 GB SSD** from both profiles. When the group reaches its target, each buyer can approve a separate PayPal Sandbox payment. Switch to **Everyday Electronics → Fulfillment** to see the payments and process a demo shipment. The buyer can then see tracking under **Payments**.

### 2. Turn unmet demand into a new deal

Open **Noah** and **Priya** in separate tabs. In **New search**, ask for a laptop with at least **32 GB RAM and 1 TB SSD**, shipped within the US. Use a **$700** budget for Noah and **$680** for Priya. Confirm each search and choose **Submit request to sellers**.

The Coordinator groups the compatible requests. The seller assistant checks stock and price, and the buyer assistants check the proposed offer against each buyer’s requirements. Open **Northstar Computing → Review unmet deal proposals** and approve the shared proposal. Return to **My requests** in the buyer profiles to see the published deal.

Buyers who prefer to wait can choose **Save as an interest** and check **My requests** for matching deals.

## Tests

```sh
npm test
```

DealPod is a local prototype with synthetic catalog and shipment data. Sandbox payments use test funds, and demo shipments do not book a carrier.

## License

See [LICENSE](LICENSE).
