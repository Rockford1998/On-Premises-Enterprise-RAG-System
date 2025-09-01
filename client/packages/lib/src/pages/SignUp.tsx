import React from "react";
import {
  Button,
  TextField,
  Typography,
  Box,
  Card,
  CardContent,
} from "@mui/material";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

const signUpSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type SignUpForm = z.infer<typeof signUpSchema>;

const SignUp: React.FC = () => {
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<SignUpForm>({
    resolver: zodResolver(signUpSchema),
  });

  const onSubmit = (data: SignUpForm) => {
    // Add API call here if needed
    alert(JSON.stringify(data, null, 2));
    reset();
  };

  return (
    <Box
      display="flex"
      justifyContent="center"
      alignItems="center"
      minHeight="100vh"
      bgcolor="#f5f5f5"
    >
      <Card sx={{ minWidth: 320, maxWidth: 360, width: "100%", boxShadow: 3 }}>
        <CardContent>
          <Typography variant="h5" mb={2} align="center">
            Sign Up
          </Typography>
          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <TextField
              label="First Name"
              fullWidth
              size="small"
              margin="normal"
              {...register("firstName")}
              error={!!errors.firstName}
              helperText={errors.firstName?.message}
              required
            />
            <TextField
              label="Last Name"
              fullWidth
              size="small"
              margin="normal"
              {...register("lastName")}
              error={!!errors.lastName}
              helperText={errors.lastName?.message}
              required
            />
            <TextField
              label="Email"
              type="email"
              fullWidth
              size="small"
              margin="normal"
              {...register("email")}
              error={!!errors.email}
              helperText={errors.email?.message}
              required
            />
            <TextField
              label="Password"
              type="password"
              fullWidth
              size="small"
              margin="normal"
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
              size="small"
              sx={{ mt: 2 }}
            >
              Sign Up
            </Button>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
};

export default SignUp;
