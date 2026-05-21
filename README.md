<div align="center">

# ⚡ Agamin — Track Every Coin

**A premium, modern cryptocurrency tracking platform built with React.**

[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-6.0-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.0-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Framer Motion](https://img.shields.io/badge/Framer_Motion-12-0055FF?style=for-the-badge&logo=framer&logoColor=white)](https://www.framer.com/motion/)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

> *Real-time prices, market data, and portfolio tools — designed for the modern investor.*

</div>

---

## ✨ Features

- 📈 **Live Market Data** — Track the top cryptocurrencies with price, volume, and market cap
- 🤖 **AI Predictions** — Algorithm-powered market sentiment and price forecasts
- 💼 **Portfolio Tracker** — Monitor your holdings with activity history
- 🖼️ **NFT Market** — Browse and track top NFT collections
- 🔄 **Exchange Rankings** — Compare global exchanges by volume, liquidity, and security
- 📚 **Education Hub** — Learn trading strategies and blockchain fundamentals
- 🎨 **Premium UI/UX** — Glassmorphism design with smooth Framer Motion animations
- ⚡ **Blazing Fast** — Built on Vite 6 for near-instant hot module replacement

---

## 🖥️ Pages

| Page | Route | Description |
|------|-------|-------------|
| 🏠 Home | `/` | Hero, market ticker, stats & market pulse |
| 📊 Market | `/market` | Crypto table with filters and price changes |
| 🔮 Prediction | `/prediction` | AI sentiment analysis and forecasts |
| 🧬 Ecosystem | `/ecosystem` | Platform infrastructure overview |
| 💼 Portfolio | `/portfolio` | Asset holdings and recent activity |
| ₿ Bitcoin | `/bitcoin` | Deep-dive into BTC stats and information |
| 📚 Learn | `/learn` | Education articles and tutorials |
| 🖼️ NFTs | `/nfts` | NFT collections and market trends |
| 🔁 Exchanges | `/exchanges` | Top exchange rankings and comparisons |
| ℹ️ About | `/about` | Company mission and values |

---

## 🛠️ Tech Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| React | 19 | UI Framework |
| Vite | 6.0 | Build Tool & Dev Server |
| Tailwind CSS | 4.x | Utility-First Styling |
| Framer Motion | 12 | Animations & Transitions |
| React Router DOM | 7 | Client-Side Routing |
| Lucide React | Latest | Icon Library |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** — version `20.19+` or `22.12+` recommended  
  *(If on Node `22.11`, Vite v6 is already pinned in this project for compatibility)*
- **npm** — version `8+`

### Installation

**1. Clone the repository**
```bash
git clone https://github.com/Pawan-Punjabi/Agamin.git
cd Agamin
```

**2. Install dependencies**
```bash
npm install
```

**3. Start the development server**
```bash
npm run dev
```

**4. Open in browser**
```
http://localhost:5173
```

---

## 📦 Available Scripts

| Script | Command | Description |
|--------|---------|-------------|
| Dev Server | `npm run dev` | Start local dev server with HMR |
| Build | `npm run build` | Build optimized production bundle |
| Preview | `npm run preview` | Preview production build locally |
| Lint | `npm run lint` | Run ESLint on the codebase |

---

## ⚡ Real-Time Crypto Pipeline

Agamin now supports the production realtime flow:

```text
Lambda
   ↓
Kinesis Stream
   ↓
Realtime Consumer Service (server.js)
   ↓
WebSocket Connections (/ws)
   ↓
React Frontend (CryptoContext)
```

The backend consumes records from AWS Kinesis and broadcasts `crypto:update` messages to every connected frontend. If AWS is not configured locally, the React app keeps working through the CoinGecko fallback fetcher.

### Backend Environment

Create a `.env` file for the Node backend:

```bash
PORT=5000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=replace_with_a_strong_secret
AWS_REGION=ap-south-1
KINESIS_STREAM_NAME=your-crypto-stream-name
KINESIS_POLL_MS=1000
KINESIS_LIMIT=100
```

Your AWS credentials should come from the normal AWS provider chain, such as an IAM role in production or local `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` values during development.

### Frontend Environment

```bash
VITE_BACKEND_URL=http://localhost:5000
VITE_REALTIME_WS_URL=ws://localhost:5000/ws
```

For production, use `https://...` for `VITE_BACKEND_URL` and `wss://.../ws` for `VITE_REALTIME_WS_URL`.

Expected Kinesis records can be a single coin object, an array of coin objects, or an object with a `coins` array. Coin objects should follow the CoinGecko-style fields already used by the UI, such as `id`, `symbol`, `name`, `image`, `current_price`, `market_cap`, `total_volume`, `market_cap_rank`, and price change percentages.

---

## 📁 Project Structure

```
Agamin/
├── public/               # Static assets (favicon, icons)
├── src/
│   ├── components/
│   │   ├── Navbar.jsx    # Navigation bar with active route highlighting
│   │   └── Footer.jsx    # Site-wide footer with links
│   ├── pages/
│   │   ├── Home.jsx      # Landing page with ticker and stats
│   │   ├── Market.jsx    # Crypto market table
│   │   ├── Prediction.jsx# AI predictions dashboard
│   │   ├── Ecosystem.jsx # Platform ecosystem overview
│   │   ├── Portfolio.jsx # User portfolio tracker
│   │   ├── Bitcoin.jsx   # Bitcoin detail page
│   │   ├── Learn.jsx     # Education hub
│   │   ├── NFTs.jsx      # NFT collections
│   │   ├── Exchanges.jsx # Exchange rankings
│   │   └── About.jsx     # About page
│   ├── App.jsx           # Root component with routing
│   ├── main.jsx          # React DOM entry point
│   └── index.css         # Global styles + Tailwind imports
├── index.html            # HTML entry point
├── vite.config.js        # Vite configuration
├── package.json          # Dependencies and scripts
└── README.md             # You are here!
```

---

## 🎨 Design System

Agamin uses a hand-crafted design token system built on **Tailwind CSS v4**:

- **Primary:** `#556069` — Muted blue-grey for primary actions
- **Tertiary:** `#705953` — Warm mauve for accents and highlights
- **Background:** `#fff7fa` — Soft warm white
- **Typography:** `Epilogue` (headlines) + `Plus Jakarta Sans` (body)
- **Effects:** Glassmorphism, mesh gradients, backdrop blur

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!

1. Fork the repository
2. Create your feature branch: `git checkout -b feature/AmazingFeature`
3. Commit your changes: `git commit -m 'Add some AmazingFeature'`
4. Push to the branch: `git push origin feature/AmazingFeature`
5. Open a Pull Request

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---

<div align="center">

**Built with ❤️ by [Pawan Punjabi](https://github.com/Pawan-Punjabi)**

⭐ *If you like this project, give it a star!* ⭐

</div>
