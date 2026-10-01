class CartDrawer extends HTMLElement {
  constructor() {
    super();

    this.addEventListener('keyup', (evt) => evt.code === 'Escape' && this.close());
    this.querySelector('#CartDrawer-Overlay').addEventListener('click', this.close.bind(this));
    this.setHeaderCartIconAccessibility();

    //Listen to in-drawer quantity and cart modifications:
    //Correcting the type coercion and quotes around undefined.
    if (typeof subscribe !== 'undefined' && typeof PUB_SUB_EVENTS !== 'undefined') {
      subscribe(PUB_SUB_EVENTS.cartUpdate, (event) => {

        const count = event?.cartData?.item_count ?? event?.cart?.item_count;
        if (count === 0) {
          this.classList.add('is-empty');
          this.querySelector('.drawer__inner')?.classList.add('is-empty');
        }

        if (!this.isSyncing) {
          this.syncGifts();
        }
      })
    }
  }

  beginUpdate() {
    this.pendingUpdates = (this.pendingUpdates || 0) + 1;
    this.classList.add('is-updating');
    this.setAttribute('aria-busy', 'true');
    this.querySelector('#CartDrawer-Checkout')?.setAttribute('disabled', '');
  }

  endUpdate() {
    this.pendingUpdates = Math.max(0, (this.pendingUpdates || 0) - 1);
    if (this.pendingUpdates > 0) return;
    this.classList.remove('is-updating');
    this.removeAttribute('aria-busy');
    this.querySelector('#CartDrawer-Checkout')?.toggleAttribute('disabled', this.classList.contains('is-empty'));
  }

  // What should the gift lines be for this cart?
  getGiftPlan(cart) {
    const t1 = parseInt(this.getAttribute('data-threshold-1'), 10);
    const v1 = parseInt(this.getAttribute('data-variant-1'), 10);
    const t2 = parseInt(this.getAttribute('data-threshold-2'), 10);
    const v2 = parseInt(this.getAttribute('data-variant-2'), 10);

    const eligible = cart.items.reduce(
      (sum, i) => (i.variant_id === v1 || i.variant_id === v2 ? sum : sum + i.original_line_price),
      0,
    );
    const qtyOf = (id) => cart.items.filter((i) => i.variant_id === id).reduce((s, i) => s + i.quantity, 0);

    const add = [];
    const update = {};
    [{ id: v1, threshold: t1 }, { id: v2, threshold: t2 }]
      .filter((g) => g.id)
      .forEach(({ id, threshold }) => {
        const current = qtyOf(id);
        const target = threshold && eligible >= threshold ? 1 : 0;
        if (current === 0 && target === 1) add.push({ id, quantity: 1 });
        else if (current > 0 && current !== target) update[id] = target;
      });

    return { add, update, changed: add.length > 0 || Object.keys(update).length > 0 };
  }

  // Applies gift changes and returns state + sections, so the caller renders ONCE
  async reconcileGifts(cart) {
    const plan = this.getGiftPlan(cart);
    const sections = this.getSectionsToRender().map((s) => s.id);
    const post = (url, body) =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      }).then((res) => res.json());

    const hasUpdate = Object.keys(plan.update).length > 0;
    const hasAdd = plan.add.length > 0;
    let state = cart;

    // Only the LAST request asks for sections
    if (hasUpdate) {
      state = await post(`${routes.cart_update_url}.js`, {
        updates: plan.update,
        ...(hasAdd ? {} : { sections }),
      });
    }
    if (hasAdd) {
      state = await post(`${routes.cart_add_url}.js`, { items: plan.add, sections });
    }
    // No gift change (or a failed request): fetch the sections separately
    if (!state.sections) {
      const fetched = await fetch(`${routes.cart_url}?sections=${sections.join(',')}&_=${Date.now()}`, {
        cache: 'no-store',
      }).then((res) => res.json());
      state = { ...state, sections: fetched };
    }
    return { ...state, item_count: state.item_count ?? cart.item_count };
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

  renderContents(parsedState, { skipGiftSync = false } = {}) {
    //Resolving the .is-empty cart drawer case:
    this.productId = parsedState.id;
    this.getSectionsToRender().forEach((section) => {
      const sectionElement = section.selector
        ? document.querySelector(section.selector)
        : document.getElementById(section.id);

      if (!sectionElement) return;
      sectionElement.innerHTML = this.getSectionInnerHTML(parsedState.sections[section.id], section.selector);
    });

    //Toggle empty state class so Dawn displays the empty warnings
    //and Continue shopping button.
    const isCartEmpty = parsedState.item_count === 0 || this.querySelector('.drawer__inner-empty') !== null;

    this.classList.toggle('is-empty', isCartEmpty);
    this.querySelector('.drawer__inner')?.classList.toggle('is-empty', isCartEmpty);


    setTimeout(() => {
      this.querySelector('#CartDrawer-Overlay').addEventListener('click', this.close.bind(this));
      //If isCartEmpty is not true:
      if (!this.classList.contains('active') && !isCartEmpty) {
        this.open();
      }
    });

    if (!this.isSyncing) {
      this.syncGifts();
    }

    if (!skipGiftSync && !this.isSyncing) {
      this.syncGifts();
    }
  }

  getSectionInnerHTML(html, selector = '.shopify-section') {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const el = selector ? doc.querySelector(selector) : doc.querySelector('.shopify-section');
    return el ? el.innerHTML : doc.body.innerHTML;
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
  async syncGifts() {
    if (this.isSyncing) return;
    if (!this.getAttribute('data-variant-1') && !this.getAttribute('data-variant-2')) return;

    this.isSyncing = true;
    this.beginUpdate();
    try {
      const cart = await fetch(`${routes.cart_url}.js?_=${Date.now()}`, { cache: 'no-store' }).then((r) => r.json());

      if (cart.item_count === 0) {
        this.classList.add('is-empty');
        this.querySelector('.drawer__inner')?.classList.add('is-empty');
        return;
      }
      if (!this.getGiftPlan(cart).changed) return;

      const state = await this.reconcileGifts(cart);
      this.renderContents(state, { skipGiftSync: true });
    } catch (err) {
      console.error('Gift sync error:', err);
    } finally {
      this.isSyncing = false;
      this.endUpdate();
    }
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
  //For the quantity updation 
  updateQuantity(line, quantity, event, name, variantId) {
    const lineItem = document.getElementById(`CartDrawer-Item-${line}`);
    const targetVariantId =
      variantId ||
      lineItem?.querySelector('[data-quantity-variant-id]')?.getAttribute('data-quantity-variant-id') ||
      lineItem?.querySelector('[data-variant-id]')?.getAttribute('data-variant-id');

    if (targetVariantId) {
      const drawer = document.querySelector('cart-drawer');
      this.enableLoading(line);
      drawer.beginUpdate();
      drawer.isSyncing = true; // stops open()/pub-sub from starting a second sync

      fetch(`${routes.cart_url}.js?_=${Date.now()}`, { cache: 'no-store' })
        .then((res) => res.json())
        .then((cart) => {
          const matchingLines = cart.items.filter((item) => String(item.variant_id) === String(targetVariantId));
          const updates = {};
          if (matchingLines.length > 0) {
            updates[matchingLines[0].key] = quantity;
            for (let i = 1; i < matchingLines.length; i++) updates[matchingLines[i].key] = 0;
          }
          return fetch(`${routes.cart_update_url}.js`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ updates }),
          });
        })
        .then((res) => res.json())
        .then((cartData) => drawer.reconcileGifts(cartData))
        .then((parsedState) => drawer.renderContents(parsedState, { skipGiftSync: true }))
        .catch((e) => console.error('Quantity update failed:', e))
        .finally(() => {
          drawer.isSyncing = false;
          drawer.endUpdate();
          this.disableLoading(line);
        });
      return;
    }

    super.updateQuantity(line, quantity, event, name, variantId);
  }
}

customElements.define('cart-drawer-items', CartDrawerItems);

