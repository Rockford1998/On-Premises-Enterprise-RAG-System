import { Button } from "@/shadcn/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/shadcn/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shadcn/ui/form";
import { Input } from "@/shadcn/ui/input";
import { useStoreAuth } from "@/store/useStoreAuth";
import { starGate } from "@/utils/starGate";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import z from "zod";

export const SignUp = () => {
  const { form, navigate, onSubmit } = useSignUp();

  return (
    <div className="flex items-center justify-center min-h-screen px-4 sm:px-0">
      <Card className="w-full max-w-sm sm:max-w-md shadow-lg rounded-2xl">
        <CardHeader className="space-y-1 text-center sm:text-left">
          <CardTitle className="text-xl sm:text-2xl font-bold">
            Create your account
          </CardTitle>
        </CardHeader>

        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <div className="flex flex-col gap-6">
                {/* First Name */}
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter first name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {/* Last Name */}
                <FormField
                  control={form.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter last name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Email */}
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="example@email.com"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Password */}
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="••••••••"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  className="w-full py-3 sm:py-2 cursor-pointer"
                >
                  Sign Up
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>

        <CardFooter className="flex-col gap-2">
          <p className="text-xs sm:text-sm text-muted-foreground text-center">
            Already have an account?
            <Button
              variant="link"
              className="px-1 text-xs sm:text-sm cursor-pointer"
              onClick={() => navigate("/signin")}
            >
              Sign In
            </Button>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
};

const useSignUp = () => {
  const setAccessToken = useStoreAuth((state) => state.setAccessToken);
  const setUserProfile = useStoreAuth((state) => state.setUserProfile);
  const navigate = useNavigate();

  // form component
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      password: "",
    },
  });

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      const response = await starGate.post("/users", values);
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
    navigate,
  };
};

// Zod schema for validation
const formSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, "First Name is required.")
    .max(50, "First Name cannot exceed 50 characters."),

  lastName: z
    .string()
    .trim()
    .min(1, "Last Name is required.")
    .max(50, "Last Name cannot exceed 50 characters."),

  email: z.string().trim().email("Please enter a valid email address."),

  password: z
    .string()
    .min(6, "Password must be at least 6 characters long.")
    .max(64, "Password cannot exceed 64 characters.")
    .regex(
      /^(?=.*[A-Za-z])(?=.*\d).+$/,
      "Password must contain at least 1 letter and 1 number.",
    ),
});
