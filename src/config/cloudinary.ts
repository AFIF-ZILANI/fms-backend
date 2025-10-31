
import { v2 } from "cloudinary";
import { ENV } from "./env";

// Cloudinary config (make sure your env variables are set)
v2.config({
    cloud_name: ENV.CLOUDINARY_CLOUD_NAME,
    api_key: ENV.CLOUDINARY_API_KEY,
    api_secret: ENV.CLOUDINARY_API_SECRET,
});

export {v2 as cloudinary}