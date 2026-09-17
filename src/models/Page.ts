import { Schema, model, models, type Model, type Types } from "mongoose";

export interface IPage {
  _id: Types.ObjectId;
  chapterId: Types.ObjectId;
  ownerId: Types.ObjectId;
  index: number;
  key: string;
  key800: string;
  thumbKey: string;
  width: number;
  height: number;
  isSpread: boolean;
  bytes: number;
  createdAt: Date;
  updatedAt: Date;
}

const pageSchema = new Schema<IPage>(
  {
    chapterId: { type: Schema.Types.ObjectId, ref: "Chapter", required: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    index: { type: Number, required: true, min: 0 },
    key: { type: String, required: true },
    key800: { type: String, required: true },
    thumbKey: { type: String, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    isSpread: { type: Boolean, default: false },
    bytes: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

pageSchema.index({ chapterId: 1, index: 1 }, { unique: true });

export const Page: Model<IPage> =
  (models.Page as Model<IPage>) ?? model<IPage>("Page", pageSchema);
