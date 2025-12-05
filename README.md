# Next.js Lead Search Microservice

This project is a microservice for B2B lead prospecting using the Apollo.io API and Supabase.

## Features

- **Lead Search API**: `/api/lead-search` endpoint to automate prospecting.
- **Dashboard**: `/lead-search` UI to manage and view searches.
- **Supabase Integration**: Persists leads to a PostgreSQL database.
- **Apollo.io Integration**: Advanced filtering and pagination for companies and people.

## Installation

1.  **Clone the repository** (if not already done).
2.  **Install dependencies**:
    ```bash
    npm install
    ```
3.  **Environment Setup**:
    Create a `.env.local` file in the root directory with the following keys:
    ```env
    NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
    NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
    APOLLO_API_KEY=your_apollo_api_key
    ```
4.  **Database Setup**:
    Run the SQL migration in `001_create_people_search_leads.sql` in your Supabase SQL Editor.

## Usage

### Running Locally
```bash
npm run dev
```
Visit `http://localhost:3000/lead-search` to use the dashboard.

### API Usage
**POST** `/api/lead-search`

Body:
```json
{
  "industry_keywords": ["software", "saas"],
  "company_location": ["United States"],
  "titles": ["CEO", "Founder"],
  "max_results": 50
}
```
