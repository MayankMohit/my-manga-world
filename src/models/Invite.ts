import { Schema, model, models, type Model, type Types } from "mongoose";
import { MEMBER_ROLES, type MemberRole } from "@/lib/shared/constants";

export interface IInvite {
  _id: Types.ObjectId;
  email: string;
  tokenHash: string;
  seriesId: Types.ObjectId;
  role: MemberRole;
  invitedBy: Types.ObjectId;
  expiresAt: Date;
  acceptedAt?: Date;
  acceptedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const inviteSchema = new Schema<IInvite>(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    tokenHash: { type: String, required: true },
    seriesId: {
      type: Schema.Types.ObjectId,
      ref: "Series",
      required: true,
      index: true,
    },
    role: { type: String, enum: MEMBER_ROLES, default: "reader" },
    invitedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date },
    acceptedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

inviteSchema.index({ tokenHash: 1 }, { unique: true });
// TTL: expired, unaccepted invites are cleaned up automatically.
inviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Invite: Model<IInvite> =
  (models.Invite as Model<IInvite>) ?? model<IInvite>("Invite", inviteSchema);
