class ProductSwatches {
    constructor() {
        this.init();
        this.initHistory();
    }

    init() {
        document.addEventListener('click', (event) => {
            const swatch = event.target.closest('[data-product-url]');

            if (!swatch) return;

            event.preventDefault();

            // this.loadProduct(swatch); is changed to url because of popstate
            const url = swatch.dataset.productUrl;
            this.loadProduct(url, true);
        });
    }

    initHistory() {
        window.addEventListener('popstate', () => {
            const url = window.location.pathname + window.location.search;
            this.loadProduct(url, false);
        })
    }


    async loadProduct(url, updateHistory = false) {
        // const url = swatch.dataset.productUrl;
        console.log('Loading Url: ', url);

        try {
            // It returns null because MainProduct-main-product doesn't exist for the current product DOM
            // So we use data-section attribute:
            const currentProduct = document.querySelector('product-info[data-section]');

            if (!currentProduct) {
                throw new Error('Current product not found');
            }

            // Get the dynamic ID of the section:
            const sectionId = currentProduct.dataset.section;
            console.log('Section ID: ', sectionId);

            // Request the same section for new product:
            const response = await fetch(`${url}?sections=${sectionId}`);

            if (!response.ok) {
                throw new Error('Failed to load product');
            }

            const sections = await response.json();
            console.log("Sections: ", sections);

            const newProductHTML = sections[sectionId];

            if (!newProductHTML) {
                throw new Error(`Section "${sectionId}" was not returned`)
            }

            //Now we parse:
            const parser = new DOMParser();
            const documentHTML = parser.parseFromString(newProductHTML, 'text/html');
            console.log(documentHTML);

            //Shopify section response from response:
            const newSection = documentHTML.querySelector(`#shopify-section-${sectionId}`);
            const currentSection = document.querySelector(`#shopify-section-${sectionId}`);

            console.log('New Section: ', newSection);
            console.log('Current section: ', currentSection);

            if (!currentSection || !newSection) {
                throw new Error('Product section cant be found');
            }

            // Replace:
            currentSection.replaceWith(newSection);

            await this.updateCartBubble();

            // Only create a history when the user clicks on a swatch:
            if (updateHistory) {
                // history.pushState changes the url of the browser without refresh
                // to get the updated content we used popstate
                history.pushState({}, '', url);
            }

        } catch (error) {
            console.error(error);
        }
    }

    async updateCartBubble() {
        try {
            const response = await fetch('/cart.js');

            if (!response.ok) {
                throw new Error('Failed to fetch cart');
            }

            const cart = await response.json();

            const cartIcon = document.querySelector('#cart-icon-bubble');

            if (!cartIcon) return;

            let bubble = cartIcon.querySelector('.cart-count-bubble');

            if (cart.item_count > 0) {

                if (!bubble) {
                    bubble = document.createElement('div');
                    bubble.className = 'cart-count-bubble';
                    cartIcon.appendChild(bubble);
                }

                bubble.innerHTML = `
                <span aria-hidden="true">${cart.item_count}</span>
                <span class="visually-hidden">
                    ${cart.item_count} items
                </span>
            `;

            } else {
                if (bubble) {
                    bubble.remove();
                }
            }
        } catch (error) {
            console.error('Cart bubble update failed:', error);
        }

    }
}

new ProductSwatches();