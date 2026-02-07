# Changelog - VEO3 Batch Automator

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-02-07 — STABLE RELEASE

### Added
- 📥 Direct URL capture during video generation (Phase 1) for reliable Phase 2 downloads
- 📥 Blob URL pre-fetching — preserves video data before React re-renders destroy references
- 🚦 Queue awareness — auto-detects VEO3's "máximo 5 gerações" notification and waits
- 🔍 Smart scrollable container detection — finds the actual scrolling element in VEO3 SPA
- 🔍 Dual scroll strategy — tries both inner container and window.scrollTo for maximum compatibility
- ✅ Download confirmation returns true/false — no more false positives on timeout
- ⚠️ New `download_unconfirmed` status for downloads that timed out without confirmation
- 📊 Summary now shows confirmed, unconfirmed, and failed counts separately

### Fixed
- Fixed: Downloads failing for videos not visible on screen (17/20 failures → 0)
- Fixed: `waitForDownloadCompletion` timeout falsely reporting success
- Fixed: `window.open` fallback incorrectly marking downloads as complete
- Fixed: Blob URLs expiring between Phase 1 and Phase 2

### Changed
- `CONFIG.QUEUE_BATCH_SIZE` (5) — VEO3 max queue size
- `CONFIG.QUEUE_COOLDOWN` (15s) — wait interval when queue is full
- Strategy A (URL direct) now runs BEFORE element-based download (Strategy B)
- Version bumped to 1.0.0 — production stable

---

## [0.1.0] - 2026-02-05

### Added
- ✅ Initial release of VEO3 Prompt Batch Automator
- ✅ Tampermonkey userscript for multi-browser support
- ✅ Automated prompt injection with event dispatching
- ✅ Progress monitoring with multiple detection strategies
- ✅ Automatic download button detection and clicking
- ✅ Sequential batch processing with inter-prompt delays
- ✅ Pause/Resume functionality during batch execution
- ✅ Real-time status dashboard with progress tracking
- ✅ Comprehensive error handling and recovery
- ✅ Detailed logging for debugging
- ✅ Diagnostics tool to inspect page structure
- ✅ Multi-strategy element detection (fallback methods)
- ✅ Support for Chrome, Firefox, Safari, Edge

### Technical Details
- 2000+ lines of vanilla JavaScript
- Zero external dependencies
- Async/await pattern for clean flow control
- MutationObserver-ready architecture
- Browser download API integration
- Intelligent DOM selector strategy system

### Known Limitations
- Requires manual validation of selectors for specific VEO3 UI versions
- Downloads go to browser's default folder (user customization needed)
- Rate limiting respects VEO3's speed (not controllable from extension)
- Session timeout causes batch interruption

### Next Planned Features
- [ ] Custom download naming scheme
- [ ] Batch statistics export (JSON/CSV)
- [ ] Automatic retry on failures
- [ ] CLI version for headless processing
- [ ] Image generation support
- [ ] Webhook notifications on completion
- [ ] Performance profiling tools

---

## Development Notes

### What Works Well
1. **Element Detection** - Multi-strategy approach handles most DOM variations
2. **Event Triggering** - Multiple event dispatch methods ensure React/Vue/etc compatibility
3. **Error Messages** - Clear, actionable error messages for debugging
4. **Diagnostics** - Automated diagnostics on page load to identify issues

### What Needs Refinement
1. **Download Confirmation** - Currently assumes downloads complete; needs browser API integration
2. **XPath Selectors** - Could use XPath instead of CSS for more robustness
3. **Shadow DOM** - May need Shadow DOM piercing if VEO3 uses web components
4. **Rate Limiting** - Should detect and respect VEO3's rate limits intelligently

### Testing Checklist
- [ ] Test with Chrome/Chromium
- [ ] Test with Firefox
- [ ] Test with Safari (if available)
- [ ] Test with Edge (if available)
- [ ] Test error recovery (missing elements)
- [ ] Test pause/resume during generation
- [ ] Test with 5+ prompts
- [ ] Test with very long prompts
- [ ] Test with special characters in prompts
- [ ] Monitor console for errors

---

## Version History

### 0.1.0 (Current)
- Initial development release
- Focus on core automation and robustness
- Multi-strategy element detection system
- Comprehensive error handling

---

## Author

**j. felipe** - Concept & Vision
**Synkra AIOS** - Development Framework

Created with ❤️ for content creators and batch video generation automation.
