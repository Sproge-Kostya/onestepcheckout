import i18n from '@vue-storefront/i18n';
import config from 'config';
import VueOfflineMixin from 'vue-offline/mixin';
import { mapGetters } from 'vuex';
import { StorageManager } from '@vue-storefront/core/lib/storage-manager';
import Composite from '@vue-storefront/core/mixins/composite';
import { currentStoreView, localizedRoute } from '@vue-storefront/core/lib/multistore';
import { Logger } from '@vue-storefront/core/lib/logger';

export default {
  name: 'Checkout',
  mixins: [Composite, VueOfflineMixin],
  data () {
    return {
      loadPaymentStatus: false,
      stockCheckCompleted: false,
      useOtherAddress: false,
      stockCheckOK: false,
      confirmation: null, // order confirmation from server
      order: {},
      personalDetails: {},
      shipping: {},
      internationalDelivery: {},
      shippingMethod: {},
      payment: {},
      orderReview: {},
      agreementIds: [],
      cartSummary: {},
      comment: '',
      validationResults: {
        personalDetails: { $invalid: true },
        shipping: { $invalid: true },
        payment: { $invalid: true }
      },
      focusedField: null
    };
  },
  computed: {
    ...mapGetters({
      isVirtualCart: 'cart/isVirtualCart',
      isThankYouPage: 'checkout/isThankYouPage',
      cartId: 'cart/getCartToken',
      getAgreements: 'checkoutLocal/getAgreements',
      getTotals: 'themeCart/getTotalsCheckout'
    })
  },
  async beforeMount () {
    await this.$store.dispatch('checkout/load');
    await this.$store.dispatch('checkoutLocal/fetchNovaCityCollection');
    this.$bus.$emit('checkout-after-load');
    this.$store.dispatch('checkout/setModifiedAt', Date.now());
    // TODO: Use one event with name as param
    this.$bus.$on('cart-after-update', this.onCartAfterUpdate);
    this.$bus.$on('cart-after-delete', this.onCartAfterUpdate);
    this.$bus.$on('checkout-after-personalDetails', this.onAfterPersonalDetails);
    this.$bus.$on('checkout-after-shippingDetails', this.onAfterShippingDetails);
    this.$bus.$on('checkout-after-internationalDelivery', this.onAfterInternationalDelivery);
    this.$bus.$on('checkout-after-paymentDetails', this.onAfterPaymentDetails);
    this.$bus.$on('checkout-after-orderReview', this.onAfterOrderReview);
    this.$bus.$on('checkout-after-cartSummary', this.onAfterCartSummary);
    this.$bus.$on('checkout-before-placeOrder', this.onBeforePlaceOrder);
    this.$bus.$on('checkout-do-placeOrder', this.onDoPlaceOrder);
    this.$bus.$on('order-after-placed', this.onAfterPlaceOrder);
    this.$bus.$on('checkout-before-shippingMethods', this.onBeforeShippingMethods);
    this.$bus.$on('checkout-after-shippingMethodChanged', this.onAfterShippingMethodChanged);
    this.$bus.$on('checkout-use-payment-to-shipping', this.usePaymentToShipping);
    if (!this.isThankYouPage) {
      this.$store.dispatch('cart/load', { forceClientState: true }).then(() => {
        if (this.$store.state.cart.cartItems.length === 0) {
          this.notifyEmptyCart();
          this.$router.push(this.localizedRoute('/'));
        } else {
          this.stockCheckCompleted = false;
          const checkPromises = [];
          for (let product of this.$store.state.cart.cartItems) { // check the results of online stock check
            if (product.onlineStockCheckid) {
              checkPromises.push(new Promise((resolve, reject) => {
                StorageManager.get('syncTasks').getItem(product.onlineStockCheckid, (err, item) => {
                  if (err || !item) {
                    if (err) Logger.error(err)();
                    resolve(null);
                  } else {
                    product.stock = item.result;
                    resolve(product);
                  }
                });
              }));
            }
          }
          Promise.all(checkPromises).then((checkedProducts) => {
            this.stockCheckCompleted = true;
            this.stockCheckOK = true;
            for (let chp of checkedProducts) {
              if (chp && chp.stock) {
                if (!chp.stock.is_in_stock) {
                  this.stockCheckOK = false;
                  chp.errors.stock = i18n.t('Out of stock!');
                  this.notifyOutStock(chp);
                }
              }
            }
          });
        }
      });
    }
    const storeView = currentStoreView();
    let country = this.$store.state.checkout.shippingDetails.country;
    if (!country) country = storeView.i18n.defaultCountry;
    this.$bus.$emit('checkout-before-shippingMethods', country);
  },
  beforeDestroy () {
    this.$store.dispatch('checkout/setModifiedAt', 0); // exit checkout
    this.$bus.$off('cart-after-update', this.onCartAfterUpdate);
    this.$bus.$off('cart-after-delete', this.onCartAfterUpdate);
    this.$bus.$off('checkout-after-personalDetails', this.onAfterPersonalDetails);
    this.$bus.$off('checkout-after-shippingDetails', this.onAfterShippingDetails);
    this.$bus.$off('checkout-after-internationalDelivery', this.onAfterInternationalDelivery);
    this.$bus.$off('checkout-after-paymentDetails', this.onAfterPaymentDetails);
    this.$bus.$off('checkout-after-orderReview', this.onAfterOrderReview);
    this.$bus.$off('checkout-after-cartSummary', this.onAfterCartSummary);
    this.$bus.$off('checkout-before-placeOrder', this.onBeforePlaceOrder);
    this.$bus.$off('checkout-do-placeOrder', this.onDoPlaceOrder);
    this.$bus.$off('order-after-placed', this.onAfterPlaceOrder);
    this.$bus.$off('checkout-before-shippingMethods', this.onBeforeShippingMethods);
    this.$bus.$off('checkout-after-shippingMethodChanged', this.onAfterShippingMethodChanged);
    this.$bus.$off('checkout-use-payment-to-shipping', this.usePaymentToShipping);
  },
  watch: {
    'OnlineOnly': 'onNetworkStatusCheck'
  },
  methods: {
    onAfterOrderReview (comment) {
      this.comment = comment;
    },
    usePaymentToShipping (update) {
      this.useOtherAddress = update;
    },
    onCartAfterUpdate (payload) {
      if (this.$store.state.cart.cartItems.length === 0) {
        this.notifyEmptyCart();
        this.$router.push(this.localizedRoute('/'));
      }
    },
    onAfterInternationalDelivery (receivedData, validationResult) {
      this.internationalDelivery = receivedData;
      this.validationResults.internationalDelivery = validationResult;
      const data = {
        'cartId': this.cartId,
        'customFields': this.internationalDelivery
      };
      const isLogin = !!this.$store.state.user.current;
      this.$store.dispatch('checkoutLocal/setInternationalDelivery', { data: data, isLogin: isLogin });
    },
    async onAfterPaymentMethodChanged () {
      if (this.loadPaymentStatus) return;
      this.loadPaymentStatus = true;
      const storeView = currentStoreView();
      let country = this.$store.state.checkout.shippingDetails.country;
      if (!country) country = storeView.i18n.defaultCountry;
      const data = {
        billingAddress: {
          region: this.payment.state,
          region_id: this.payment.region_id ? this.payment.region_id : 0,
          country_id: this.shipping.country,
          street: [this.shipping.streetAddress, this.shipping.apartmentNumber ? this.shipping.apartmentNumber : this.shipping.streetAddress],
          company: this.payment.company,
          telephone: this.payment.phoneNumber,
          postcode: config.tax.defaultZipCode,
          city: this.shipping.city,
          firstname: this.payment.firstName,
          lastname: this.payment.lastName,
          email: this.payment.emailAddress,
          region_code: this.payment.region_code ? this.payment.region_code : '',
          vat_id: this.payment.taxId
        },
        countryId: this.shipping.country,
        postcode: config.tax.defaultZipCode,
        cartId: this.$store.state.cart.cartServerToken ? this.$store.state.cart.cartServerToken.toString() : '',
        email: this.payment.emailAddress ? this.payment.emailAddress : '',
        paymentMethod: {
          method: this.selectedPayment ? this.selectedPayment : this.getPaymentMethod(),
          extension_attributes: {
            agreement_ids: this.getAgreements
          }
        },
        extension_attributes: { agreement_ids: this.getAgreements },
        agreement_ids: this.getAgreements,
        method: this.selectedPayment ? this.selectedPayment : this.getPaymentMethod()
      };
      await this.$store.dispatch('checkoutLocal/setPaymentInformation', { data, isLogin: !!this.$store.state.user.current });
      await this.$store.dispatch('cart/syncTotals', { forceServerSync: true, methodsData: this.shippingMethod });
      this.loadPaymentStatus = false;
    },
    async onAfterShippingMethodChanged (payload) {
      await this.$store.dispatch('cart/syncTotals', { forceServerSync: true, methodsData: payload });
      this.shippingMethod = payload;
    },
    onBeforeShippingMethods (country) {
      const storeView = currentStoreView();
      if (!country) country = storeView.i18n.defaultCountry;
      this.$store.dispatch('checkout/updatePropValue', ['country', country]);
      this.$store.dispatch('cart/syncTotals', { forceServerSync: true });
      this.$forceUpdate();
    },
    beforePlaceOrderToLiqPay (payload) {
      const cartId = payload.order.cart_id;
      const orderNumber = payload.confirmation.orderNumber;
      this.$store.dispatch('checkoutLocal/liqPayOrder', { orderNumber, cartId });
    },
    async onAfterPlaceOrder (payload) {
      this.confirmation = payload.confirmation;

      if (this.order.addressInformation.payment_method_code === 'liqpaymagento_liqpay') {
        this.beforePlaceOrderToLiqPay(payload);
      }

      this.$store.dispatch('checkout/setThankYouPage', true);
      this.$store.dispatch('user/getOrdersHistory', { refresh: true, useCache: true });
      Logger.debug(payload.order)();
    },
    onBeforePlaceOrder (payload) {
    },
    onAfterCartSummary (receivedData) {
      this.cartSummary = receivedData;
    },
    onDoPlaceOrder (additionalPayload) {
      if (this.$store.state.cart.cartItems.length === 0) {
        this.notifyEmptyCart();
        this.$router.push(this.localizedRoute('/'));
      } else {
        this.payment.paymentMethodAdditional = additionalPayload;
        this.placeOrder();
      }
    },
    onAfterPaymentDetails (receivedData, validationResult) {
      this.payment = receivedData;
      this.validationResults.payment = validationResult;
      this.savePaymentDetails();
      this.onAfterPaymentMethodChanged();
    },
    onAfterShippingDetails (receivedData, validationResult) {
      this.shipping = receivedData;
      this.validationResults.shipping = validationResult;
      this.saveShippingDetails();
    },
    onAfterPersonalDetails (receivedData, validationResult) {
      this.personalDetails = receivedData;
      this.validationResults.personalDetails = validationResult;
      this.savePersonalDetails();
      this.focusedField = null;
    },
    onNetworkStatusCheck (isOnline) {
      this.checkConnection(isOnline);
    },
    checkStocks () {
      let isValid = true;
      for (let child of this.$children) {
        if (child.hasOwnProperty('$v')) {
          console.log('Valid', child.$vnode.componentOptions.tag, ' : ', child.$v.$invalid);
          if (child.$v.$invalid) {
            // Check if child component is Personal Details.
            // If so, then ignore validation of account creation fields.
            isValid = false;
            break;
          }
        }
      }

      if (typeof navigator !== 'undefined' && navigator.onLine) {
        if (!this.stockCheckCompleted) {
          if (!this.stockCheckOK) {
            isValid = false;
            this.notifyNotAvailable();
          }
        }
      }
      return isValid;
    },
    async sendComment () {
      const url = `${config.api.url}/api/ext/kraina/checkout/guest-carts/${this.cartId}/set-order-comment`;
      const data = {
        'cartId': this.cartId,
        'orderComment': { 'comment': this.comment }
      };

      try {
        await fetch(url, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(data)
        }).then(response => response.json()).then(data => console.log(data));
      } catch (err) {
        console.log(err);
      }
    },
    checkConnection (isOnline) {
      if (!isOnline) {
        this.notifyNoConnection();
      }
    },
    // This method checks if there exists a mapping of chosen payment method to one of Magento's payment methods.
    getPaymentMethod () {
      let paymentMethod = this.payment.paymentMethod;
      if (config.orders.payment_methods_mapping.hasOwnProperty(paymentMethod)) {
        paymentMethod = config.orders.payment_methods_mapping[paymentMethod];
      }
      return paymentMethod;
    },
    prepareOrder () {
      this.order = {
        user_id: this.$store.state.user.current ? this.$store.state.user.current.id.toString() : '',
        cart_id: this.$store.state.cart.cartServerToken ? this.$store.state.cart.cartServerToken.toString() : '',
        products: this.$store.state.cart.cartItems,
        totals: this.getTotals,
        addressInformation: {
          billingAddress: {
            region: this.payment.state,
            region_id: this.payment.region_id ? this.payment.region_id : 0,
            country_id: this.shipping.country,
            street: [this.shipping.streetAddress, this.shipping.apartmentNumber ? this.shipping.apartmentNumber : this.shipping.streetAddress],
            company: this.payment.company,
            telephone: this.payment.phoneNumber,
            postcode: config.tax.defaultZipCode,
            city: this.shipping.city,
            firstname: this.payment.firstName,
            lastname: this.payment.lastName,
            email: this.payment.emailAddress,
            region_code: this.payment.region_code ? this.payment.region_code : '',
            vat_id: this.payment.taxId
          },
          shipping_method_code: this.shippingMethod?.method_code ? this.shippingMethod.method_code : this.shipping.shippingMethod,
          shipping_carrier_code: this.shippingMethod?.carrier_code ? this.shippingMethod.carrier_code : this.shipping.shippingCarrier,
          payment_method_code: this.getPaymentMethod(),
          payment_method_additional: this.payment.paymentMethodAdditional,
          shippingExtraFields: this.shipping.extraFields
        }
      };
      if (!this.isVirtualCart) {
        if (!this.useOtherAddress) {
          this.order.addressInformation.shippingAddress = {
            region: this.payment.state,
            region_id: this.payment.region_id ? this.payment.region_id : 0,
            country_id: this.shipping.country,
            street: [this.shipping.streetAddress, this.shipping.apartmentNumber ? this.shipping.apartmentNumber : this.shipping.streetAddress],
            company: '',
            telephone: this.payment.phoneNumber,
            postcode: config.tax.defaultZipCode,
            city: this.shipping.city,
            firstname: this.payment.firstName,
            lastname: this.payment.lastName,
            email: this.payment.emailAddress,
            region_code: this.payment.region_code ? this.payment.region_code : ''
          };
        } else {
          this.order.addressInformation.shippingAddress = {
            region: this.payment.state,
            region_id: this.payment.region_id ? this.payment.region_id : 0,
            country_id: this.shipping.country,
            street: [this.shipping.streetAddress, this.shipping.apartmentNumber ? this.shipping.apartmentNumber : this.shipping.streetAddress],
            company: '',
            telephone: this.shipping.phoneNumber,
            postcode: config.tax.defaultZipCode,
            city: this.shipping.city,
            firstname: this.shipping.firstName,
            lastname: this.shipping.lastName,
            email: this.payment.emailAddress,
            region_code: this.shipping.region_code ? this.shipping.region_code : ''
          };
        }
      }
      return this.order;
    },
    placeOrder () {
      this.checkConnection({ online: typeof navigator !== 'undefined' ? navigator.onLine : true });
      if (this.checkStocks()) {
        if (this.comment) {
          this.sendComment();
        }
        this.onAfterPaymentMethodChanged().then(r => {
          this.$store.dispatch('checkout/placeOrder', { order: this.prepareOrder() });
        });
      } else {
        this.notifyValidData();
      }
    },
    savePersonalDetails () {
      this.$store.dispatch('checkout/savePersonalDetails', this.personalDetails);
    },
    saveShippingDetails () {
      this.$store.dispatch('checkout/saveShippingDetails', this.shipping);
    },
    savePaymentDetails () {
      this.$store.dispatch('checkout/savePaymentDetails', this.payment);
    }
  },
  metaInfo () {
    return {
      title: this.$route.meta.title || i18n.t('Checkout'),
      meta: this.$route.meta.description ? [{
        vmid: 'description',
        name: 'description',
        content: this.$route.meta.description
      }] : []
    };
  },
  asyncData ({ store, route, context }) { // this is for SSR purposes to prefetch data
    return new Promise((resolve, reject) => {
      if (context) context.output.cacheTags.add(`checkout`);
      if (context) context.server.response.redirect(localizedRoute('/'));
      resolve();
    });
  }
};
