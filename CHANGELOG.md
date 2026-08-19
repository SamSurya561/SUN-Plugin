# SUN Plugin — Changelog

All notable changes to the SUN Plugin will be documented in this file.

## [0.5.0] - 2026-08-20

### Added
- **Native MOGRT Parameter Editing**: Built a robust ExtendScript bridge enabling Live Sync editing of active MOGRT templates natively inside the plugin's new Edit tab (Sliders, Checkboxes, Colors, Text).
- **Custom User Folders (Collections)**: Added complete organizational control allowing users to create, rename, and delete custom folders in the sidebar.
- **Contextual Folder Imports**: Importing assets while viewing a custom folder now automatically adds those assets to the active folder.
- **Cleaned Up MOGRT Library**: Generated clean thumbnail previews and removed 3rd-party watermarks/branding from the provided asset corpus.
- **Improved Installer**: Windows uninstaller now correctly pulls the high-res SUN Plugin icon in the Settings app.

## [0.4.0] - 2026-08-20

### Added
- **Seamless UI Resizing**: Fixed grid constraints so the UI properly spans the entire width of the Premiere Pro panel.
- **Optimized Asset Import**: Switched the `Import` button to use a native OS file picker, preventing UI freezes caused by large library scans.
- **Create Template Alternative**: Added a "Create Template" button that guides users to natively export presets/MOGRTs, with an instant ingest feature to bypass Adobe's ExtendScript limitations.
- **Thumbnail Cropping Fix**: Updated preview thumbnails to use `object-contain` instead of `object-cover` so text/overlays display fully in the details panel.

## [0.3.0] - 2026-08-19

### Added
- **React 18 & Tailwind CSS Migration**: Complete UI rewrite from Vanilla JS to React 18 + Tailwind CSS, bundled with Vite as IIFE (no ES module issues in CEP).
- **Advanced Shadcn-Inspired Dark Theme**: Ultra-dark zinc palette (`#0a0a0b` → `#0f0f11`), warm amber/orange accent gradients matching the SUN branding, glassmorphism sidebar.
- **Rounded & Curvy UI**: All cards, buttons, inputs, and badges use `rounded-2xl`/`rounded-xl` for a modern, smooth aesthetic.
- **Ultra-Thin Scrollbars**: 4px webkit scrollbars with rounded thumbs and transparent tracks.
- **Drag & Drop with Custom Ghost**: Drag assets from the grid directly to Premiere Pro timeline. Amber-branded drag ghost shows the asset name during drag.
- **Absolute Path Resolution**: Drag payloads now use the absolute OS file path via `host.toAbsolute()`, fixing the timeline drop rejection.
- **Hover Preview Overlay**: Cards show a backdrop-blurred overlay on hover with Insert (+) and Favourite (♥) quick-action buttons.
- **Detail Panel**: Click any asset to open a slide-in detail panel with preview, metadata badges, tags, and edit parameters (Primary Text, Scale, Color).
- **Version Display**: Plugin version shown in both the top bar and the status bar footer.
- **SUN Branding**: Gradient logo in header, gradient "SUN Plugin v0.3.0" badge in status bar.
- **Search with Debounce**: Responsive search input with 120ms debounce and clear button.
- **Category Tree Navigation**: Collapsible sidebar tree with type icons, per-category counts, and amber accent on active items.
- **Import Button**: Gradient-styled import button triggers library scan with status feedback.
- **Smooth Animations**: `fade-in`, `slide-up`, `scale-in` Tailwind keyframe animations on cards and panels.
- **Custom Range & Color Inputs**: Styled range sliders with amber thumb, color picker with rounded border.

### Changed
- **Extension ID**: Changed from `com.sunplugin.premiere` to `com.sun.plugin`.
- **Plugin Name**: Renamed from "Sun Library" to "SUN Plugin" in Premiere Pro menu.
- **Installer**: Output renamed to `SUNPluginSetup.exe`, installs to `com.sun.plugin` directory.
- **Build Pipeline**: Vite now outputs IIFE format (`sun-app.js` + `sun-app.css`) instead of ES modules, ensuring reliable loading in CEP's Chromium.
- **Fixture Block Removed**: Development fixture assets can now be dragged to the timeline (Premiere may still reject non-functional MOGRTs natively).

### Fixed
- **UI Not Rendering**: Fixed the broken UI caused by `type="module"` scripts failing in CEP's `file://` context. Now uses regular `<script>` tags with IIFE bundle.
- **CSS Not Loading**: Fixed missing stylesheet in previous builds where the Vite CSS output went to the wrong directory.
- **Drag & Drop Rejection**: Fixed by resolving library-relative paths to absolute OS paths before setting the `com.adobe.cep.dnd.file.0` data transfer.

## [0.2.0] - 2026-08-19

### Added
- Initial Shadcn UI attempt (Vanilla JS).
- Tree View sidebar for asset hierarchy.
- Edit panel placeholder.
- Drag and drop framework.

### Changed
- Switched to Inter system-ui font stack.

## [0.1.0] - 2026-08-19

### Added
- Initial release of SUN Plugin for Adobe Premiere Pro.
- Full asset library system with scanning, indexing, and search.
- Support for MOGRT, SFX, Music, Transitions, LUTs, Presets, Captions, Overlays, Effects.
- Development asset generator for testing at scale.
- Inno Setup installer with registry configuration for unsigned CEP extensions.
- CEP + ExtendScript integration for asset insertion at playhead.
