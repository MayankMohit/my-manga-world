import { Schema, model, models, type Model, type Types } from "mongoose";
import { MEMBER_ROLES, type MemberRole } from "@/lib/shared/constants";

export interface ISeriesMember {
  _id: Types.ObjectId;
  seriesId: Types.ObjectId;
  userId: Types.ObjectId;
  role: MemberRole;
  addedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const seriesMemberSchema = new Schema<ISeriesMember>(
  {
    seriesId: { type: Schema.Types.ObjectId, ref: "Series", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: MEMBER_ROLES, required: true },
    addedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

seriesMemberSchema.index({ seriesId: 1, userId: 1 }, { unique: true });
seriesMemberSchema.index({ userId: 1 });
seriesMemberSchema.index({ seriesId: 1 });

export const SeriesMember: Model<ISeriesMember> =
  (models.SeriesMember as Model<ISeriesMember>) ??
  model<ISeriesMember>("SeriesMember", seriesMemberSchema);
