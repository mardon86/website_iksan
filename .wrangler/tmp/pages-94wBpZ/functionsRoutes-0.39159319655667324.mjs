import { onRequestPost as __api_create_order_js_onRequestPost } from "/home/mardon86/iksan/website/functions/api/create-order.js"
import { onRequestPost as __api_doku_notification_js_onRequestPost } from "/home/mardon86/iksan/website/functions/api/doku-notification.js"
import { onRequestGet as __api_order_status_js_onRequestGet } from "/home/mardon86/iksan/website/functions/api/order-status.js"
import { onRequest as __api_create_order_js_onRequest } from "/home/mardon86/iksan/website/functions/api/create-order.js"
import { onRequest as __api_doku_notification_js_onRequest } from "/home/mardon86/iksan/website/functions/api/doku-notification.js"
import { onRequest as __api_order_status_js_onRequest } from "/home/mardon86/iksan/website/functions/api/order-status.js"

export const routes = [
    {
      routePath: "/api/create-order",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_create_order_js_onRequestPost],
    },
  {
      routePath: "/api/doku-notification",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_doku_notification_js_onRequestPost],
    },
  {
      routePath: "/api/order-status",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_order_status_js_onRequestGet],
    },
  {
      routePath: "/api/create-order",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_create_order_js_onRequest],
    },
  {
      routePath: "/api/doku-notification",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_doku_notification_js_onRequest],
    },
  {
      routePath: "/api/order-status",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_order_status_js_onRequest],
    },
  ]