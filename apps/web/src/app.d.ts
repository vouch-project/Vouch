// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }

  // Custom HTML elements registered by Reown AppKit.
  // Declaring them here prevents TypeScript/Svelte from complaining about
  // unknown element names if the built-in web-components are used in templates.
  namespace svelteHTML {
    interface IntrinsicElements {
      'appkit-button': {
        size?: 'md' | 'sm';
        label?: string;
        loadingLabel?: string;
        disabled?: boolean;
      };
      'appkit-network-button': Record<string, unknown>;
      'appkit-account-button': {
        disabled?: boolean;
        balance?: 'show' | 'hide';
      };
    }
  }
}

export {};
