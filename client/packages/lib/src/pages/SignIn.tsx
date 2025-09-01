import React from "react";
import { Button, TextField, Typography, Box, Link, Card, CardContent } from "@mui/material";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link as RouterLink } from "react-router-dom";
import { CONST_PAGE_ROUTES } from "../constants";

const signInSchema = z.object({
  email: z.email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type SignInForm = z.infer<typeof signInSchema>;

const SignIn: React.FC = () => {
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<SignInForm>({
    resolver: zodResolver(signInSchema),
  });

  const onSubmit = (data: SignInForm) => {
    // Add API call here if needed
    alert(JSON.stringify(data, null, 2));
    reset();
  };

  return (
    <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh" bgcolor="#f5f5f5">
      <Card sx={{ minWidth: 320, maxWidth: 360, width: '100%', boxShadow: 3 }}>
        <CardContent>
          <Typography variant="h5" mb={2} align="center">
            Sign In
          </Typography>
          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <TextField
              label="Email"
              type="email"
              fullWidth
              margin="normal"
              size="small"
              {...register("email")}
              error={!!errors.email}
              helperText={errors.email?.message}
              required
            />
            <TextField
              label="Password"
              type="password"
              fullWidth
              margin="normal"
              size="small"
              {...register("password")}
              error={!!errors.password}
              helperText={errors.password?.message}
              required
            />
            <Button
              type="submit"
              variant="contained"
              color="primary"
              fullWidth
              sx={{ mt: 2 }}
            >
              Sign In
            </Button>
            <Box mt={2} textAlign="center">
              <Typography variant="body2">
                Don't have an account?{" "}
                <Link
                  component={RouterLink}
                  to={CONST_PAGE_ROUTES.SignUp}
                  underline="hover"
                >
                  Create
                </Link>
              </Typography>
            </Box>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
};

export default SignIn;
