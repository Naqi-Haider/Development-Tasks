class CartDrawer extends HTMLElement {
  constructor() {
    super();

    this.addEventListener('keyup', (evt) => evt.code === 'Escape' && this.close());
    this.querySelector('#CartDrawer-Overlay').addEventListener('click', this.close.bind(this));
    this.setHeaderCartIconAccessibility();

    //Listen to in-drawer quantity and cart modifications:
    if(typeof subscribe != 'undefined' && typeof PUB_SUB_EVENTS != undefined){
      subscribe(PUB_SUB_EVENTS.cartUpdate, () => {
        if(!this.isSyncing){
          this.syncGifts();
        }
      })
    }
  }

  setHeaderCartIconAccessibility() {
    const cartLink = document.querySelector('#cart-icon-bubble');
    if (!cartLink) return;

    cartLink.setAttribute('role', 'button');
    cartLink.setAttribute('aria-haspopup', 'dialog');
    cartLink.addEventListener('click', (event) => {
      event.preventDefault();
      this.open(cartLink);
    });
    cartLink.addEventListener('keydown', (event) => {
      if (event.code.toUpperCase() === 'SPACE') {
        event.preventDefault();
        this.open(cartLink);
      }
    });
  }

  open(triggeredBy) {
    if (this.classList.contains('active')) return;
    if (triggeredBy) this.setActiveElement(triggeredBy);
    const cartDrawerNote = this.querySelector('[id^="Details-"] summary');
    if (cartDrawerNote && !cartDrawerNote.hasAttribute('role')) this.setSummaryAccessibility(cartDrawerNote);

    this.syncGifts();


    // here the animation doesn't seem to always get triggered. A timeout seem to help
    setTimeout(() => {
      this.classList.add('animate', 'active');
    });

    this.addEventListener(
      'transitionend',
      () => {
        const containerToTrapFocusOn = this.classList.contains('is-empty')
          ? this.querySelector('.drawer__inner-empty')
          : document.getElementById('CartDrawer');
        const focusElement = this.querySelector('.drawer__inner') || this.querySelector('.drawer__close');
        trapFocus(containerToTrapFocusOn, focusElement);
      },
      { once: true },
    );

    document.body.classList.add('overflow-hidden');

    // cart-drawer-items is a CartItems subclass that extends createViewEventElement.
    // Its `view-event-trigger="manual"` skips auto-dispatch on connect; we fire
    // it here when the drawer opens, with `context: 'dialog'` from the payload attribute.
    this.querySelector('cart-drawer-items')?.dispatchViewEvent();
  }

  close() {
    this.classList.remove('active');
    removeTrapFocus(this.activeElement);
    document.body.classList.remove('overflow-hidden');
  }

  setSummaryAccessibility(cartDrawerNote) {
    cartDrawerNote.setAttribute('role', 'button');
    cartDrawerNote.setAttribute('aria-expanded', 'false');

    if (cartDrawerNote.nextElementSibling.getAttribute('id')) {
      cartDrawerNote.setAttribute('aria-controls', cartDrawerNote.nextElementSibling.id);
    }

    cartDrawerNote.addEventListener('click', (event) => {
      event.currentTarget.setAttribute('aria-expanded', !event.currentTarget.closest('details').hasAttribute('open'));
    });

    cartDrawerNote.parentElement.addEventListener('keyup', onKeyUpEscape);
  }

  renderContents(parsedState) {
    this.querySelector('.drawer__inner').classList.contains('is-empty') &&
      this.querySelector('.drawer__inner').classList.remove('is-empty');
    this.productId = parsedState.id;
    this.getSectionsToRender().forEach((section) => {
      const sectionElement = section.selector
        ? document.querySelector(section.selector)
        : document.getElementById(section.id);

      if (!sectionElement) return;
      sectionElement.innerHTML = this.getSectionInnerHTML(parsedState.sections[section.id], section.selector);
    });

    setTimeout(() => {
      this.querySelector('#CartDrawer-Overlay').addEventListener('click', this.close.bind(this));
      this.open();
    });

    if (!this.isSyncing) {
      this.syncGifts();
    }
  }

  getSectionInnerHTML(html, selector = '.shopify-section') {
    return new DOMParser().parseFromString(html, 'text/html').querySelector(selector).innerHTML;
  }

  getSectionsToRender() {
    return [
      {
        id: 'cart-drawer',
        selector: '#CartDrawer',
      },
      {
        id: 'cart-icon-bubble',
      },
    ];
  }

  getSectionDOM(html, selector = '.shopify-section') {
    return new DOMParser().parseFromString(html, 'text/html').querySelector(selector);
  }

  setActiveElement(element) {
    this.activeElement = element;
  }

  //Sync Gifts code inside this web component class:
  syncGifts() {
  if (this.isSyncing) return;

  const t1 = parseInt(this.getAttribute('data-threshold-1'), 10);
  const v1 = parseInt(this.getAttribute('data-variant-1'), 10);
  const t2 = parseInt(this.getAttribute('data-threshold-2'), 10);
  const v2 = parseInt(this.getAttribute('data-variant-2'), 10);

  if (!v1 && !v2) return;

  fetch(`${routes.cart_url}.js`)
    .then((res) => res.json())
    .then((cart) => {
      // Calculate eligible subtotal EXCLUDING the free gifts
      const eligibleTotal = cart.items.reduce((sum, item) => {
        if (item.variant_id === v1 || item.variant_id === v2) return sum;
        return sum + item.original_line_price;
      }, 0);

      const currentQty1 = cart.items
        .filter((i) => i.variant_id === v1)
        .reduce((sum, i) => sum + i.quantity, 0);

      const currentQty2 = cart.items
        .filter((i) => i.variant_id === v2)
        .reduce((sum, i) => sum + i.quantity, 0);

      const targetQty1 = Boolean(v1 && t1 && eligibleTotal >= t1) ? 1 : 0;
      const targetQty2 = Boolean(v2 && t2 && eligibleTotal >= t2) ? 1 : 0;

      // If cart already matches target quantities, exit immediately
      if (currentQty1 === targetQty1 && currentQty2 === targetQty2) {
        return;
      }

      this.isSyncing = true;
      const sections = this.getSectionsToRender().map((s) => s.id);

      // 1. Items needing initial injection (requires /cart/add.js)
      const itemsToAdd = [];
      if (v1 && currentQty1 === 0 && targetQty1 === 1) itemsToAdd.push({ id: v1, quantity: 1 });
      if (v2 && currentQty2 === 0 && targetQty2 === 1) itemsToAdd.push({ id: v2, quantity: 1 });

      // 2. Items needing quantity reduction or removal (requires /cart/update.js)
      const updates = {};
      if (v1 && currentQty1 > 0 && currentQty1 !== targetQty1) updates[v1] = targetQty1;
      if (v2 && currentQty2 > 0 && currentQty2 !== targetQty2) updates[v2] = targetQty2;

      let syncPromise = Promise.resolve();

      // Execute updates/removals first if needed
      if (Object.keys(updates).length > 0) {
        syncPromise = syncPromise.then(() =>
          fetch(`${routes.cart_update_url}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ updates, sections: itemsToAdd.length > 0 ? [] : sections })
          }).then((res) => res.json())
        );
      }

      // Execute additions second if needed
      if (itemsToAdd.length > 0) {
        syncPromise = syncPromise.then(() =>
          fetch(`${routes.cart_add_url}.js`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ items: itemsToAdd, sections })
          }).then((res) => res.json())
        );
      }

      return syncPromise
        .then((response) => {
          if (response && response.sections) {
            this.renderContents(response);
          }
        })
        .catch((err) => console.error('Gift sync error:', err))
        .finally(() => {
          this.isSyncing = false;
        });
    })
    .catch((err) => console.error('Cart read error:', err));
}
}

customElements.define('cart-drawer', CartDrawer);

class CartDrawerItems extends CartItems {
  getSectionsToRender() {
    return [
      {
        id: 'CartDrawer',
        section: 'cart-drawer',
        selector: '.drawer__inner',
      },
      {
        id: 'cart-icon-bubble',
        section: 'cart-icon-bubble',
        selector: '.shopify-section',
      },
    ];
  }
}

customElements.define('cart-drawer-items', CartDrawerItems);

