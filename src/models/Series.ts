import { Schema, model, models, type Model, type Types } from "mongoose";

export interface ISeries {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  title: string;
  sortTitle: string;
  coverKey?: string;
  description?: string;
  tags: string[];
  chapterCount: number;
  memberCount: number;
  lastReadAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const seriesSchema = new Schema<ISeries>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true, trim: true },
    sortTitle: { type: String, required: true },
    coverKey: { type: String },
    description: { type: String },
    tags: { type: [String], default: [] },
    chapterCount: { type: Number, default: 0, min: 0 },
    memberCount: { type: Number, default: 1, min: 0 },
    lastReadAt: { type: Date },
  },
  { timestamps: true },
);

seriesSchema.index({ ownerId: 1, sortTitle: 1 });
seriesSchema.index({ ownerId: 1, lastReadAt: -1 });

export const Series: Model<ISeries> =
  (models.Series as Model<ISeries>) ?? model<ISeries>("Series", seriesSchema);
