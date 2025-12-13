import axios from "axios";
const apiUrl = import.meta.env.VITE_BE_URL;
export const starGate = axios.create({
    baseURL: apiUrl,
});

starGate.interceptors.request.use(
    (request) => {
        const state = localStorage.getItem("store-auth");
        if (state) {
            const jsonData = JSON.parse(state);
            const accessToken = jsonData.state.accessToken;

            request.headers.Authorization = `Bearer ${accessToken}`;
        }
        return request;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Response Interceptor: Handle 401 errors globally
starGate.interceptors.response.use(
    (response) => response,
    (error) => {
        const status = error.response?.status;
        const message = error.response?.data?.message;
        if (status === 401 && message?.includes("Session")) {
            localStorage.removeItem("store-auth");
            window.location.href = "auth/signin";
            window.alert(error)
            // useStoreNotification.getState().notifyError(message);
        }

        return Promise.reject(error);
    }
);
