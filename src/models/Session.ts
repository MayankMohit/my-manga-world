import { Schema, model, models, type Model, type Types } from "mongoose";

export interface ISession {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  refreshTokenHash: string;
  familyId: string;
  userAgent?: string;
  ip?: string;
  expiresAt: Date;
  revokedAt?: Date;
  replacedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<ISession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    refreshTokenHash: { type: String, required: true, index: true },
    familyId: { type: String, required: true, index: true },
    userAgent: { type: String },
    ip: { type: String },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    replacedBy: { type: Schema.Types.ObjectId, ref: "Session" },
  },
  { timestamps: true },
);

// TTL: MongoDB removes the document once expiresAt passes.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session: Model<ISession> =
  (models.Session as Model<ISession>) ?? model<ISession>("Session", sessionSchema);
