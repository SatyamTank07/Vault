# Vault 🚀

Vault is a premium, full-stack note-taking and task-management application designed for clarity and productivity. It offers multiple ways to visualize and interact with your thoughts, featuring seamless synchronization between different perspectives.



## ✨ Key Features

### 📐 Multi-Dimensional Visualization
- **Grid View**: A clean, organized layout for quick scanning and management of all your notes.
- **Canvas (Mind Map)**: A powerful, hierarchical visualization tool for brainstorming and connecting ideas using `XYFlow` and `dagre` auto-layout.
- **Timeline View**: A dedicated schedule view for managing deadlines, tasks, and time-sensitive information.

### 📝 Notion-Style Editor
- Powered by **TipTap**, providing a rich, WYSIWYG editing experience.
- Full **Markdown** support.
- Interactive task lists and image embedding.

### 🔄 Smart Synchronization
- **Single Source of Truth**: Changes made in one view (like the Canvas) are instantly reflected in others (Grid, Timeline).
- **Recurring Tasks**: Sophisticated scheduling system with support for daily, weekly, and custom recurrence patterns.

### 🖼️ Asset Management
- Note-specific image uploads with dedicated storage structures.
- Integrated lightbox for distraction-free image viewing.

### 📱 Premium UX/UI
- Modern, responsive design with a sleek **Purple Theme**.
- Glassmorphism effects and smooth micro-animations.
- Mobile-optimized interface for on-the-go productivity.

---

## 🛠️ Tech Stack

### Frontend
- **Framework**: React 19 + Vite
- **Language**: TypeScript
- **State/UI**: Vanilla CSS (Custom System), Lucide Icons
- **Visuals**: XYFlow (React Flow) for Canvas, Dagre for layouts
- **Editor**: TipTap (Rich Text / Markdown)

### Backend
- **Framework**: FastAPI (Python)
- **Database**: PostgreSQL
- **ORM**: SQLAlchemy
- **Environment**: Docker & Docker Compose

---

## 🚀 Getting Started

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Node.js](https://nodejs.org/) (v18+)

### Installation & Setup

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd Vault
   ```

2. **Start Backend & Database (Docker)**:
   The backend and PostgreSQL database are fully containerized. **Running via Docker is required** as the backend depends on the containerized database environment.
   ```bash
   # From the root directory
   docker-compose up --build -d
   ```
   The backend will be available at `http://localhost:8000`.

3. **Start Frontend (Local Development)**:
   Run the frontend locally for the best development experience with Hot Module Replacement (HMR).
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   The application will be available at `http://localhost:5173`.

---

Built with ❤️ for better thinking.
