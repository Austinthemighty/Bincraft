// ItemCards - Client-side helpers

// Sidebar toggle (desktop: collapse/expand, mobile: open/close)
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (window.innerWidth <= 600) {
    sidebar.classList.toggle('mobile-open');
  } else {
    sidebar.classList.toggle('collapsed');
    localStorage.setItem('sidebar-collapsed', sidebar.classList.contains('collapsed'));
  }
}

function toggleMobileMenu() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('mobile-open');
}

// Restore sidebar state + close on outside tap
document.addEventListener('DOMContentLoaded', () => {
  const sidebar = document.getElementById('sidebar');
  if (sidebar && localStorage.getItem('sidebar-collapsed') === 'true' && window.innerWidth > 600) {
    sidebar.classList.add('collapsed');
  }

  // Mobile menu button
  const mobileBtn = document.getElementById('mobile-menu-btn');
  if (mobileBtn) {
    mobileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebar.classList.toggle('mobile-open');
    });
  }

  // Sidebar collapse/expand toggle (bottom chevron button)
  const sidebarToggle = document.getElementById('sidebar-toggle-btn');
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.innerWidth <= 600) {
        // On mobile, close the sidebar
        sidebar.classList.remove('mobile-open');
      } else {
        // On desktop/tablet, collapse/expand
        sidebar.classList.toggle('collapsed');
        localStorage.setItem('sidebar-collapsed', sidebar.classList.contains('collapsed'));
      }
    });
  }

  // Close mobile sidebar when tapping a nav link
  document.querySelectorAll('.nav-item').forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 600 && sidebar) {
        sidebar.classList.remove('mobile-open');
      }
    });
  });

  // Close mobile sidebar when tapping outside
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 600 && sidebar?.classList.contains('mobile-open')) {
      if (!sidebar.contains(e.target) && !e.target.closest('#mobile-menu-btn')) {
        sidebar.classList.remove('mobile-open');
      }
    }
  });

  // Auto-dismiss flash messages
  const flash = document.querySelector('.flash');
  if (flash) {
    setTimeout(() => {
      flash.style.opacity = '0';
      flash.style.transition = 'opacity 200ms ease-out';
      setTimeout(() => flash.remove(), 200);
    }, 4000);
  }
});

// Logout
async function logout() {
  try {
    await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' });
    window.location.href = '/auth/login';
  } catch (e) {
    window.location.href = '/auth/login';
  }
}

// Confirm destructive actions
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-confirm]');
  if (el && !confirm(el.dataset.confirm)) {
    e.preventDefault();
  }
});
