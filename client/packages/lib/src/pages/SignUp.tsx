import React from "react";
import { Button, TextField, Typography } from "@mui/material";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { PageWrap } from "../components";

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
    <PageWrap>
      <Typography variant="h5" mb={2} align="center">
        Sign Up
      </Typography>
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <TextField
          label="First Name"
          fullWidth
          margin="normal"
          {...register("firstName")}
          error={!!errors.firstName}
          helperText={errors.firstName?.message}
          required
        />
        <TextField
          label="Last Name"
          fullWidth
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
          sx={{ mt: 2 }}
        >
          Sign Up
        </Button>
      </form>
    </PageWrap>
  );
};

export default SignUp;
