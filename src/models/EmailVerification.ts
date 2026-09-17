import { Schema, model, models, type Model, type Types } from "mongoose";

/**
 * A pending, email-verified signup. Created by signup-start (which argon2-hashes
 * the chosen password into it) and consumed by verify-email, which then creates
 * the real `User`. No account exists until the code is confirmed. The document
 * self-expires via a TTL index, and there is at most one per email (start
 * upserts), so an unverified signup never squats a unique email address.
 */
export interface IEmailVerification {
  _id: Types.ObjectId;
  email: string;
  codeHash: string;
  passwordHash: string;
  name?: string;
  attempts: number;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const emailVerificationSchema = new Schema<IEmailVerification>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    codeHash: { type: String, required: true },
    passwordHash: { type: String, required: true },
    name: { type: String, trim: true },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// TTL: MongoDB removes the pending signup once expiresAt passes.
emailVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const EmailVerification: Model<IEmailVerification> =
  (models.EmailVerification as Model<IEmailVerification>) ??
  model<IEmailVerification>("EmailVerification", emailVerificationSchema);
