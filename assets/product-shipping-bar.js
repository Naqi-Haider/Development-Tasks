if (!customElements.get('shipping-progress-bar')) {
  class ShippingProgressBar extends HTMLElement {
    connectedCallback() {
      this.threshold = Number(this.dataset.thresholdCents || 7500);
      this.textEl = this.querySelector('[data-shipping-bar-text]');
      this.refresh();

      if (typeof subscribe === 'function' && typeof PUB_SUB_EVENTS !== 'undefined' && PUB_SUB_EVENTS.cartUpdate) {
        subscribe(PUB_SUB_EVENTS.cartUpdate, () => this.refresh());
      } else {
        document.addEventListener('cart:refresh', () => this.refresh());
      }
    }

    refresh() {
      fetch('/cart.js')
        .then((response) => response.json())
        .then((cart) => this.update(cart.total_price))
        .catch(() => {});
    }

    update(totalCents) {
      const remaining = Math.max(this.threshold - totalCents, 0);
      if (remaining === 0) {
        this.textEl.textContent = "You've unlocked free shipping!";
      } else {
        const formatted = new Intl.NumberFormat(document.documentElement.lang || 'en', {
          style: 'currency',
          currency: (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || 'USD',
        }).format(remaining / 100);
        this.textEl.textContent = `You're ${formatted} away from free shipping`;
      }
    }
  }
  customElements.define('shipping-progress-bar', ShippingProgressBar);
}