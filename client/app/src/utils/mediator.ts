import axios from "axios";

export const mediator = axios.create({
    baseURL: "http://localhost:3000",
});

mediator.interceptors.request.use(
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
mediator.interceptors.response.use(
    (response) => response,
    (error) => {
        const status = error.response?.status;
        const message = error.response?.data?.message;
        if (status === 401 && message?.includes("Session")) {
            localStorage.removeItem("store-auth");
            window.location.href = "auth/login";
            window.alert(error)
            // useStoreNotification.getState().notifyError(message);
        }

        return Promise.reject(error);
    }
);
