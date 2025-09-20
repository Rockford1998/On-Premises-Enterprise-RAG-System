import { useStoreAuth } from "@/store/useStoreAuth";
import axios from "axios";
import React, { useEffect } from "react";

interface AxiosInterceptorProps {
    children: React.ReactNode;
}
const AxiosInterceptor = ({ children }: AxiosInterceptorProps) => {
    const accessToken = useStoreAuth((state) => state.accessToken);

    useEffect(() => {
        const setupInterceptors = () => {
            // Request interceptor
            const requestInterceptor = axios.interceptors.request.use(
                (config) => {
                    config.headers.Authorization = `Bearer ${accessToken}`;
                    return config;
                },
                (error) => {
                    return Promise.reject(error);
                }
            );

            return () => {
                axios.interceptors.request.eject(requestInterceptor);
            };
        };

        const cleanup = setupInterceptors();

        return cleanup;
    }, [accessToken]);

    return <>{ children } </>;
};

export default AxiosInterceptor;
