import { Schema, model, models, type Model, type Types } from "mongoose";

/**
 * A single-use password-reset token. Only the sha-256 hash of the opaque token
 * is stored; the raw token exists solely in the emailed link. Consumed on a
 * successful reset (`usedAt`) and self-expires via a TTL index.
 */
export interface IPasswordReset {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  usedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const passwordResetSchema = new Schema<IPasswordReset>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date },
  },
  { timestamps: true },
);

// TTL: MongoDB removes the token once expiresAt passes.
passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PasswordReset: Model<IPasswordReset> =
  (models.PasswordReset as Model<IPasswordReset>) ??
  model<IPasswordReset>("PasswordReset", passwordResetSchema);
