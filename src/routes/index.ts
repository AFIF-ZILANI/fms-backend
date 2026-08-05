import { Hono } from "hono";
import { userRoutes } from "@routes/user.routes";
// import { productRoutes } from "@routes/product.routes"; // add more here

export const appRoutes = new Hono();

appRoutes.route("/users", userRoutes);
// appRoutes.route("/products", productRoutes);
