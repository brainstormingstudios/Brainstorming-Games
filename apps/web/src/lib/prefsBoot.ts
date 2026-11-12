/** Storage key for per-browser preferences (shared by the boot script and `lib/prefs`). */
export const PREFS_KEY = 'bg.prefs';

/**
 * Runs before first paint (inlined in <head>) so the saved theme, low-data mode and sidebar
 * state never flash. Keep it dependency-free and tiny. This file has no 'use client' so server
 * layouts can read the string.
 */
export const PREFS_BOOT_SCRIPT = `(function(){try{var p=JSON.parse(localStorage.getItem('${PREFS_KEY}')||'{}'),d=document.documentElement,c=navigator.connection;if(p.theme==='light')d.setAttribute('data-theme','light');if(p.lowData===true||(p.lowData===undefined&&c&&c.saveData))d.setAttribute('data-low-data','true');if(p.sidebarCollapsed)d.setAttribute('data-sidebar','collapsed');if(p.schoolSafe)d.setAttribute('data-school-safe','true');}catch(e){}})();`;
