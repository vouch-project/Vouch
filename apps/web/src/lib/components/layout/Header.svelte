<script lang="ts">
  import WalletButton from '$lib/components/ui/WalletButton.svelte';
</script>

<header>
  <a href="/" class="logo" aria-label="Vouch – home">
    <span class="logo-mark" aria-hidden="true">V</span>
    <span class="logo-text">Vouch</span>
  </a>

  <nav aria-label="Main navigation">
    <a href="/">Home</a>
    <a href="/dashboard">Dashboard</a>
    <a href="/borrow">Borrow</a>
    <a href="/lend">Lend</a>
  </nav>

  <div class="header-actions">
    <WalletButton />
  </div>
</header>

<style>
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.875rem 2rem;
    border-bottom: 1px solid #e5e7eb;
    background: #fff;
    position: sticky;
    top: 0;
    z-index: 50;
  }

  .logo {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    text-decoration: none;
    color: #111827;
    flex-shrink: 0;
  }

  .logo:hover .logo-mark {
    background: #374151;
  }

  .logo-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    background: #111827;
    color: #fff;
    border-radius: 0.5rem;
    font-weight: 800;
    font-size: 1rem;
    transition: background 0.15s;
  }

  .logo-text {
    font-size: 1.2rem;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  nav {
    display: flex;
    gap: 1.75rem;
  }

  nav a {
    text-decoration: none;
    color: #6b7280;
    font-size: 0.875rem;
    font-weight: 500;
    transition: color 0.12s;
  }

  nav a:hover {
    color: #111827;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-shrink: 0;
  }

  @media (max-width: 640px) {
    nav {
      display: none;
    }
  }
</style>
