# Wavelength — AI Calling System

A full-stack AI calling platform that uses Google Gemini Live for real-time voice conversations and Plivo/WhatsApp for telephony.

```
wavelength/
├── frontend/   # Next.js 16 UI + API proxy routes
└── backend/    # Python FastAPI — Gemini Live voice engine
```

---

## Quick Start

### Prerequisites
- Node.js 18+
- Python 3.11+
- PostgreSQL database
- Plivo account (or WhatsApp Business API)
- Google API key (Gemini)

### 1. Set up environment variables

```bash
# Frontend
cp .env.example frontend/.env.local
# Edit frontend/.env.local — fill in all values

# Backend
cp .env.example backend/.env
# Edit backend/.env — fill in all values
# Make sure PORT=3001 in backend/.env
```

### 2. Install dependencies

```bash
# Install everything at once
npm run install

# Or individually:
npm run install:frontend
npm run install:backend
```

### 3. Run locally

```bash
# Run both frontend and backend together
npm run dev
```

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001

---

## How Frontend ↔ Backend Connects

The Next.js frontend does **not** call the Python backend directly from the browser. Instead, it uses Next.js API routes as a proxy:

```
Browser → Next.js API route (/api/call) → Python FastAPI (/call/conversational)
```

The environment variable `CALL_SERVER_URL` (set in `frontend/.env.local`) controls where the Next.js routes forward requests:

```
CALL_SERVER_URL=http://localhost:3001/call/conversational
```

### Key integration points

| Frontend route | Backend endpoint | Purpose |
|---|---|---|
| `POST /api/call` | `POST /call/conversational` | Initiate a call |
| `POST /api/call-hangup` | `POST /calls/{uuid}/hangup` | Hang up a call |
| `GET /api/call-updates` | `GET /calls/{uuid}/status` | Poll call status |
| `GET /api/calls/{id}/recording` | `GET /calls/{id}/recording` | Download recording |
| `POST /api/call-ended` | _(webhook from backend)_ | Receive call results |

The backend calls `POST /api/call-ended` on the frontend when a call finishes (webhook URL is passed during call initiation).

---

## Architecture

```
┌─────────────────────────────────┐
│  Browser (React / Next.js UI)  │
└──────────────┬──────────────────┘
               │ HTTP
┌──────────────▼──────────────────┐
│  Next.js API Routes             │
│  - Auth (Firebase)              │
│  - DB queries (PostgreSQL)      │
│  - Proxy to FastAPI backend     │
└──────────────┬──────────────────┘
               │ HTTP (CALL_SERVER_URL)
┌──────────────▼──────────────────┐
│  FastAPI Backend (Python)       │
│  - Gemini 2.5 Live WebSocket    │
│  - Plivo telephony              │
│  - Real-time audio streaming    │
│  - Call recording + transcript  │
└─────────────────────────────────┘
               │ WebSocket
┌──────────────▼──────────────────┐
│  Google Gemini 2.5 Live API     │
└─────────────────────────────────┘
               │ Plivo XML + WebSocket
┌──────────────▼──────────────────┐
│  Plivo (Phone calls)            │
└─────────────────────────────────┘
```

---

## Production Deployment

### Frontend
Deploy `frontend/` to Vercel (or any Node.js host). Set environment variables in the Vercel dashboard:
- Set `CALL_SERVER_URL` to your deployed backend URL, e.g. `https://api.yourdomain.com/call/conversational`

### Backend
Deploy `backend/` to any server (Oracle Cloud, AWS EC2, etc.). See [backend/docs/OCI_DEPLOYMENT_GUIDE.md](backend/docs/OCI_DEPLOYMENT_GUIDE.md).

Set `PLIVO_CALLBACK_URL` to your backend's public URL so Plivo can reach the WebSocket endpoint.

---

## Development Notes

- The backend default port in `backend/src/core/config.py` is `3000`. **Always set `PORT=3001` in `backend/.env`** to avoid conflicting with the Next.js frontend.
- For Plivo to reach your local backend, use [ngrok](https://ngrok.com): `ngrok http 3001` and set `PLIVO_CALLBACK_URL` to the ngrok URL.
