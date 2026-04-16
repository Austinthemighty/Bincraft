// Bincraft - Client-side helpers

// --- Motion preferences ---
// Live-updates if the user toggles OS setting during a session
const motionPref = window.matchMedia('(prefers-reduced-motion: reduce)');
function prefersReducedMotion() {
  return motionPref.matches;
}

// Sidebar toggle (desktop: collapse/expand, mobile: open/close)
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (window.innerWidth <= 600) {
    toggleMobileMenu();
  } else {
    sidebar.classList.toggle('collapsed');
    localStorage.setItem('sidebar-collapsed', sidebar.classList.contains('collapsed'));
  }
}

function toggleMobileMenu() {
  const sidebar = document.getElementById('sidebar');
  const btn = document.getElementById('mobile-menu-btn');
  const isOpen = sidebar.classList.toggle('mobile-open');
  if (btn) {
    btn.setAttribute('aria-expanded', String(isOpen));
    btn.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
  }
}

function closeMobileMenu() {
  const sidebar = document.getElementById('sidebar');
  const btn = document.getElementById('mobile-menu-btn');
  sidebar?.classList.remove('mobile-open');
  if (btn) {
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Open navigation menu');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const sidebar = document.getElementById('sidebar');

  // Restore collapsed state on desktop
  if (sidebar && localStorage.getItem('sidebar-collapsed') === 'true' && window.innerWidth > 600) {
    sidebar.classList.add('collapsed');
  }

  // Mobile menu button
  const mobileBtn = document.getElementById('mobile-menu-btn');
  if (mobileBtn) {
    mobileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMobileMenu();
    });
  }

  // Sidebar collapse/expand toggle (bottom chevron button)
  const sidebarToggle = document.getElementById('sidebar-toggle-btn');
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.innerWidth <= 600) {
        closeMobileMenu();
      } else {
        sidebar.classList.toggle('collapsed');
        localStorage.setItem('sidebar-collapsed', sidebar.classList.contains('collapsed'));
      }
    });
  }

  // Close mobile sidebar when tapping a nav link
  document.querySelectorAll('.nav-item').forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 600) closeMobileMenu();
    });
  });

  // Close mobile sidebar when tapping outside
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 600 && sidebar?.classList.contains('mobile-open')) {
      if (!sidebar.contains(e.target) && !e.target.closest('#mobile-menu-btn')) {
        closeMobileMenu();
      }
    }
  });

  // Esc key closes mobile menu
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar?.classList.contains('mobile-open')) {
      closeMobileMenu();
      document.getElementById('mobile-menu-btn')?.focus();
    }
  });

  // Auto-dismiss flash messages (respects reduced-motion)
  const flash = document.querySelector('.flash');
  if (flash) {
    setTimeout(() => {
      if (prefersReducedMotion()) {
        flash.remove();
      } else {
        flash.classList.add('flash-exit');
        setTimeout(() => flash.remove(), 220);
      }
    }, 5000);
  }

  // Prevent double-submit on forms: disable submit button after first click
  document.querySelectorAll('form').forEach(form => {
    form.addEventListener('submit', (e) => {
      const btn = form.querySelector('button[type="submit"], input[type="submit"]');
      if (!btn || btn.dataset.allowMultiSubmit === 'true') return;
      const originalText = btn.textContent;
      btn.disabled = true;
      // Pulse class is harmless under reduced-motion (CSS media query zeroes animation)
      btn.classList.add('is-pending');
      if (btn.tagName === 'BUTTON') {
        btn.dataset.originalText = originalText;
        btn.textContent = btn.dataset.pending || 'Working...';
      }
      // Safety net: re-enable after 10s if navigation didn't happen
      setTimeout(() => {
        if (btn.disabled) {
          btn.disabled = false;
          btn.classList.remove('is-pending');
          if (btn.dataset.originalText) btn.textContent = btn.dataset.originalText;
        }
      }, 10000);
    }, true);
  });
});

// Logout
async function logout() {
  try {
    await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' });
  } catch (e) {
    // Navigate regardless — local session will be cleared on next request
  }
  window.location.href = '/auth/login';
}

// Confirm destructive actions
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-confirm]');
  if (el && !confirm(el.dataset.confirm)) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
});
