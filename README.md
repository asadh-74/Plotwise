# Plotwise

**Real estate operations, brought into one workspace.** Plotwise is a full-stack property platform concept for agencies that need to move from a new listing or inquiry to a viewing, signed lease, and ongoing property management—with repeatable workflow automation along the way.

> Built as a portfolio project to demonstrate practical product engineering across a Node.js API, MySQL data model, responsive browser UI, and n8n automation workflows. Demo records and market data are illustrative.

## Why an agency would use it

A small property team often has listings in one place, inquiries in another, viewing details in email, and rent or maintenance follow-up in spreadsheets. Plotwise brings those workflows into one operational dashboard so agents can follow up consistently and property managers can see what needs attention.

## Product areas

- **Sales CRM:** searchable property listings, inquiry capture, lead pipeline, viewing calendar, and performance analytics.
- **Deal finder:** import market listings, compare asking prices, flag potential opportunities, and save search criteria for alerts.
- **Property management:** leases, rent schedules, overdue tracking, maintenance tickets, and owner statements.
- **Workflow automation:** 12 example n8n workflows for lead scoring and replies, viewing coordination, follow-ups, listing content, rent and lease reminders, maintenance triage, owner statements, and deal alerts.
- **Role-aware access:** separate staff, buyer, landlord, and tenant experiences backed by JWT authentication.

## Example workflow

1. A prospective buyer sends an inquiry about a listing.
2. Plotwise records the lead and starts the configured automation.
3. n8n can score and categorize the inquiry, draft a contextual response, and notify the agent.
4. The agent tracks follow-up and books a viewing.
5. When a lead becomes a tenant, the property can move into lease and maintenance workflows.

If n8n is not configured, the app includes local fallback behavior for selected demo workflows. Email, calendar, and messaging actions require the corresponding n8n credentials and configuration.

## Technology

**Node.js · Express · MySQL · vanilla JavaScript · n8n · Gemini API · Leaflet · Docker Compose**

The application code and detailed technical guide are in [plotwise/plotwise](plotwise/plotwise/README.md). It includes the API routes, SQL schema, seed and migration scripts, UI, Render blueprint, and importable n8n workflow JSON files.

## Run the demo locally

Requirements: Node.js 18+ and Docker Compose (for the included MySQL service).

```bash
git clone https://github.com/asadh-74/Plotwise.git
cd Plotwise/plotwise/plotwise
npm install
docker compose up -d mysql
cp .env.example .env
```

Add a strong local JWT_SECRET and AUTOMATION_SECRET to .env. The example configuration uses the included local MySQL database and enables illustrative demo records.

```bash
npm run dev
```

Open http://localhost:3000. The health endpoint is http://localhost:3000/health.

To preview the n8n workflows, start the full Compose stack and follow the credential and webhook setup in the [technical guide](plotwise/plotwise/README.md#connect-n8n). External integrations are opt-in; never commit real API keys, database passwords, or customer information.

## Deployment

The Render blueprint is at [plotwise/plotwise/render.yaml](plotwise/plotwise/render.yaml). When creating a service from the blueprint, set the repository root directory to plotwise/plotwise, then configure the database and optional integration environment variables in Render. Review the demo-seed setting and demo accounts before exposing any deployment to real users.

## Portfolio walkthrough

A reviewer can explore:

- The product UI and responsive real estate workflows.
- The API routes and relational schema.
- The n8n workflow definitions and their event-driven integration points.
- The local demo setup and deployment configuration.

For a concise walkthrough, see the [60-second demo script](plotwise/plotwise/README.md#60-second-demo-script).

## Project links

- **Source:** [github.com/asadh-74/Plotwise](https://github.com/asadh-74/Plotwise)
- **Detailed README:** [Architecture, setup, API, and workflow documentation](plotwise/plotwise/README.md)
- **Automation definitions:** [n8n/workflows](plotwise/plotwise/n8n/workflows)
