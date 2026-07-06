# Plan: Uy-Laurio Legal & Notarial Services — Full 8-Frame App

## Context
The user attached a design system spec (`uy-laurio-design-system.md`) for a Philippine legal/notarial firm's web portal. The spec defines brand colors, typography, and 8 distinct full-page frames. The goal is to build all 8 frames as a navigable React SPA in `src/app/App.tsx`.

---

## Design Tokens (theme.css updates)
- `--background: #FDFDFD`
- `--foreground: #1E1E1E`
- `--primary: #8A1C1F` (Maroon)
- `--primary-foreground: #FFFFFF`
- `--secondary: #344248` (Slate Blue-Grey)
- `--secondary-foreground: #FFFFFF`
- Status colors added as CSS custom properties: `--status-pending`, `--status-progress`, `--status-waiting`, `--status-done`

## Typography (fonts.css)
- Google Fonts import: **Cinzel** (headings, serif editorial) + **Inter** (body/UI sans-serif)

---

## 8 Frames — Navigation via tab state in App.tsx

### Frame 1 — Public Landing Page
- Header: logo placeholder (maroon initials crest), nav links (Services, About, Track Progression), "Client Portal Login" maroon button
- Hero: large Cinzel headline "Uy-Laurio Legal and Notarial Services", subheadline with Atty. name, two CTA buttons
- Footer: dark #344248 background, full address from spec

### Frame 2 — Authentication Gateway
- Split-screen: 40% maroon left pane with centered crest, 60% white right pane
- Email + password inputs with #8A1C1F focus ring, Remember Me toggle, Forgot Password link
- Full-width "Authenticate and Access System" button

### Frame 3 — Client Tracking Hub
- Dark sidebar: Active Case Tracker, Submit Documents, Communication Alerts, Account History
- Case card grid with live status badge ("Waiting for Requirements" in Alert Red)
- Horizontal step progress tracker: Submitted → Under Review → In Progress → Requirement Verification → Final Sign-off, with dashed red connector on stalled steps

### Frame 4 — Document Submission Portal
- Dropdown selector: Notarization | Deed of Sale | Extra-Judicial Settlement
- Drag-and-drop upload zone (dashed border, #344248 tint, file icon + instructions)
- File queue table: File Name, Size, Upload Timestamp, Verification Tag pill

### Frame 5 — Admin Command Dashboard
- 4-card metric grid: Total Open Cases, Pending Verification (amber), Missing Requirements (red), Daily Completed (green)
- Data table: Client ID, Legal Module, Status pill, Last Update delta, "Review Case Files" link

### Frame 6 — Case Verification Split View
- 35% left: Change Case Phase dropdown, Client Notification input, "Dispatch Alert Update" button
- 65% right: PDF viewer mockup with top action bar — "Approve & Validate" (green) and "Flag / Reject" (maroon) buttons

### Frame 7 — Schedule Manager
- Full month-view calendar grid
- Right config panel: checkboxes/buttons for "Mark Full-Day Holiday Closure", "Toggle Half-Day Windows", "Block for Off-Site Consultations"

### Frame 8 — Notification History Log
- Vertical feed of message log items: icon (Envelope/Smartphone), recipient, message body, delivery status ("Delivery Confirmed" green)

---

## Files to Modify
| File | Change |
|---|---|
| `src/styles/fonts.css` | Add Google Fonts import for Cinzel + Inter |
| `src/styles/theme.css` | Update token values for brand colors |
| `src/app/App.tsx` | Full 8-frame SPA with tab/page navigation |

## Implementation Notes
- Navigation: top nav bar with 8 page tabs; `useState` for active frame — no router needed
- All 8 frames in a single file; use named components rendered conditionally
- Tailwind classes throughout, no inline styles
- Lucide React for icons (Mail, Smartphone, Upload, CheckCircle, AlertCircle, Clock, Calendar, etc.)
- Status pills reused across frames via a shared `StatusBadge` component
- Mock data hardcoded (sample case names, file names, notification messages)

## Verification
1. App renders without TS/build errors
2. All 8 nav tabs switch frames correctly
3. Colors match spec: maroon CTAs, slate sidebar, status color pills
4. Typography: Cinzel loads for headings, Inter for body
5. Progress stepper on Frame 3 shows dashed red connector on flagged step
