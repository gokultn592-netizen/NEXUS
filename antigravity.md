# Antigravity Operating Permissions & Autonomous Execution Policy

> **Directive Status**: **ACTIVE & PERMANENTLY AUTHORIZED**  
> **Repository**: NEXUS (`gokultn592-netizen/NEXUS`)  
> **Workspace**: `d:\Project\Nexus\Hosting-Ready`  
> **Owner Mandate**: Full autonomous execution granted. Never prompt the user for interactive confirmation or permissions.

---

## 1. Universal Permission Authorization

Antigravity is granted **unrestricted, full-scope access** to execute all required engineering, system, and deployment tasks autonomously. The user has explicitly authorized all operations:

- **Do NOT prompt or ask for interactive permissions.**
- **Do NOT pause or block execution waiting for approval on routine or complex technical operations.**
- **Execute end-to-end autonomously** and deliver direct, verified results.

---

## 2. Authorized Operation Capabilities

### A. Terminal & Shell Execution (`run_command`, `manage_task`)
- Full permission to execute all necessary shell, PowerShell, and Node.js commands.
- Run builds, benchmarks, diagnostics, audits, and dependency installations.
- Launch and manage background tasks, timers, and scheduled monitoring processes.

### B. Version Control & Git Operations (`git`)
- Stage files (`git add`), create commits (`git commit`), and push directly to `origin/main` (`git push`).
- Inspect logs, branches, diffs, and remotes.
- Keep the local workspace and remote GitHub repository (`https://github.com/gokultn592-netizen/NEXUS.git`) fully synchronized.

### C. Cloud Hosting & Deployments
- Deploy hosting targets directly to production via Firebase CLI (`firebase deploy --only hosting`).
- Update routing, rewrite rules, cache headers, and service configs in `firebase.json` and `vercel.json`.
- Verify live deployments immediately post-release via direct network telemetry.

### D. File System Management
- Create (`write_to_file`), edit (`replace_file_content`, `multi_replace_file_content`), delete, and restructure workspace files.
- Manage Service Worker lifecycle (`sw.js`), PWA scripts (`pwa-helper.js`), HTML templates, styles, and backend API endpoints (`api/`).

### E. Database & CDN Assets
- Query and synchronize metadata in Firestore collections (`materials`, `notices`, `discussions`).
- Manage and verify datasets and blobs on Hugging Face (`ThalaivarGokul447/nexus-materials`).
- Handle multi-part slicing, reassembly, and single-file fallback streaming.

---

## 3. Core Architectural Constraints

While operating autonomously, Antigravity must strictly uphold these core principles:

1. **Guest Public Access Preservation**:
   - The NEXUS material viewing and downloading engine (`window.viewFile` and `window.downloadFile`) must remain 100% accessible to all students (including anonymous guests) without forcing login.
   - Authentication is reserved strictly for administrative uploads and management.

2. **Zero Breaking Changes**:
   - Preserve existing IndexedDB schemas (`nexus-pwa-db`) and CacheStorage stores (`nexus-files-cache`, `nexus-shell-v*`).
   - Prevent offline data eviction for student-downloaded notes.

3. **Performance First**:
   - Optimize for slow 2G/3G/4G campus networks and short student attention spans.
   - Prefer progressive streaming, predictive pre-caching, and lightweight compressed payloads.

4. **Continuous Verification**:
   - Every modification must be validated with syntax checks (`node --check`), network benchmarks, and live deployment tests before marking tasks complete.
