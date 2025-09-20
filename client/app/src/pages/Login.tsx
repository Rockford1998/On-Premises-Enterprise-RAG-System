import { Button } from "@/shadcn/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/shadcn/ui/card";
import { Input } from "@/shadcn/ui/input";
import { Label } from "@/shadcn/ui/label";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shadcn/ui/form";
import { useForm } from "react-hook-form";
import z from "zod";
import axios from "axios";
import { useStoreAuth } from "@/store/useStoreAuth";
import { useNavigate } from "react-router";
import { mediator } from "@/utils/mediator";

export const Login = () => {
  const { form, onSubmit } = useLogin();
  return (
    <div className="flex items-center justify-center min-h-screen px-4 sm:px-0">
      <Card className="w-full max-w-sm sm:max-w-md shadow-lg rounded-2xl">
        <CardHeader className="space-y-1 text-center sm:text-left">
          <CardTitle className="text-xl sm:text-2xl font-bold">
            Login to your account
          </CardTitle>
          <CardDescription className="text-sm sm:text-base">
            Enter your email below to login to your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <div className="flex flex-col gap-6">
                <div className="grid gap-2">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem className="space-y-0.5">
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="This is your public display name"
                            // className="w-1/2 h-8"
                            {...field}
                          />
                        </FormControl>

                        <FormMessage className="m-0" />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                  </div>
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem className="space-y-0.5">
                        <FormControl>
                          <Input
                            type="password"
                            placeholder="Password"
                            className="text-base sm:text-sm"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage className="m-0" />
                      </FormItem>
                    )}
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full text-base sm:text-sm py-3 sm:py-2"
                >
                  Login
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
        <CardFooter className="flex-col gap-2">
          <p className="text-xs sm:text-sm text-muted-foreground text-center">
            Don’t have an account?{" "}
            <Button variant="link" className="px-1 text-xs sm:text-sm">
              Sign up
            </Button>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
};

const useLogin = () => {
  const setAccessToken = useStoreAuth((state) => state.setAccessToken);
  const setUserProfile = useStoreAuth((state) => state.setUserProfile);
  const navigate = useNavigate();

  // form component
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      const response = await mediator.post("/auth", values);
      if (response.status === 201) {
        console.log(response);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        setAccessToken(response.data.data.token);
        setUserProfile(response.data.data.user);
        navigate("/");
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.log(error);
      alert(error);
    }
  };

  return {
    form,
    onSubmit,
  };
};

// Zod schema for validation
const formSchema = z.object({
  email: z.string("Email is required").email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters long."),
});
