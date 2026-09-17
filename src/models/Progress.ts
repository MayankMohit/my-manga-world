import { Schema, model, models, type Model, type Types } from "mongoose";

export interface IProgress {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  chapterId: Types.ObjectId;
  seriesId: Types.ObjectId;
  pageIndex: number;
  completed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const progressSchema = new Schema<IProgress>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    chapterId: { type: Schema.Types.ObjectId, ref: "Chapter", required: true },
    seriesId: { type: Schema.Types.ObjectId, ref: "Series", required: true },
    pageIndex: { type: Number, default: 0, min: 0 },
    completed: { type: Boolean, default: false },
  },
  { timestamps: true },
);

progressSchema.index({ userId: 1, chapterId: 1 }, { unique: true });
progressSchema.index({ userId: 1, seriesId: 1 });
progressSchema.index({ userId: 1, updatedAt: -1 });

export const Progress: Model<IProgress> =
  (models.Progress as Model<IProgress>) ?? model<IProgress>("Progress", progressSchema);
