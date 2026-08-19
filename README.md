# SUN Plugin

An advanced, modern asset library and workflow toolkit for Adobe Premiere Pro. Bring all your assets—MOGRTs, SFX, LUTs, Overlays, and more—into a single, unified interface that lives directly inside Premiere Pro.

```
  MOGRTs · SFX · LUTs · Transitions · Overlays · Presets · Captions · Guides
  Live MOGRT Editing · Custom Folders · Drag & Drop · Offline First
```

---

## 🌟 Key Features

### Native MOGRT Parameter Editing (Live Sync)
You no longer have to leave the plugin to edit templates. Use the **Edit** tab to read the active clip from your Premiere Pro timeline, and customize text, colors, sliders, and checkboxes directly inside the SUN Plugin UI with real-time syncing.

### Custom User Folders (Collections)
Take full control of your library organization. Create custom folders in the left sidebar, rename/delete them, and import assets directly into specific folders for project-based organization.

### Drag & Drop Timeline Insertion
Drag assets from the SUN Plugin grid directly into the Premiere Pro timeline. Visual drag ghosts let you know exactly what asset is being placed.

### Clean, Modern UI
Built with React 18, Tailwind CSS, and a Shadcn-inspired dark theme. It features an ultra-dark zinc palette, warm amber/orange accent gradients, glassmorphism elements, and rounded UI components that look beautiful on any screen.

### Lightning Fast Native Imports
Ingest your personal library of assets instantly using a native OS file picker. Absolutely no UI freezing when importing large batches.

### Fully Offline
The SUN Plugin never needs the internet to operate. Your assets are stored locally, and search, filtering, and insertion happen in milliseconds.

---

## 🚀 Installation

1. Navigate to the **Releases** tab on GitHub.
2. Download the latest `SUNPluginSetup.exe` installer.
3. Run the installer (Make sure Premiere Pro is closed).
4. Open Adobe Premiere Pro.
5. In the top menu, go to **Window > Extensions > SUN Plugin**.

---

## 🛠 Asset Types Supported

| Category | Insertion Method |
|---|---|
| **MOGRT / Templates** | Directly on Timeline (Live Editable) |
| **SFX / Music** | Added to active Audio Track |
| **LUTs / Color Presets** | Instantly applied to selected clips via Lumetri Color |
| **Overlays / Video / Image** | Added to active Video Track |
| **Effect Presets (.prfpset)** | Import supported for organization; manual drag from Effects panel required by Adobe |

---

## 🗂 Library Architecture

The core of SUN Plugin does not care where an asset came from. An asset is simply a row in a lightning-fast local JSON database with a file beside it. 

Your library lives entirely separate from the plugin's install directory, ensuring your assets are never lost during plugin updates.

---

## 💻 Tech Stack
* **UI**: React 18, Tailwind CSS, Vite
* **Host**: Adobe CEP (Common Extensibility Platform) / Node.js
* **Engine**: Adobe ExtendScript (`.jsx`) for Premiere Pro interactions
