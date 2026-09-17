import { Schema, model, models, type Model, type Types } from "mongoose";
import {
  UPLOAD_STATUS,
  RENDER_MODES,
  type UploadStatus,
  type RenderMode,
} from "@/lib/shared/constants";

export interface UploadChapterMeta {
  number?: number;
  title?: string;
  volume?: number;
}

export interface IUpload {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  rawKey: string;
  originalName: string;
  size: number;
  status: UploadStatus;
  multipartUploadId?: string;
  jobId?: string;
  seriesId?: Types.ObjectId;
  chapterMeta?: UploadChapterMeta;
  renderMode?: RenderMode;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const chapterMetaSchema = new Schema<UploadChapterMeta>(
  {
    number: { type: Number },
    title: { type: String, trim: true },
    volume: { type: Number },
  },
  { _id: false },
);

const uploadSchema = new Schema<IUpload>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    rawKey: { type: String, required: true, index: true },
    originalName: { type: String, required: true },
    size: { type: Number, required: true, min: 0 },
    status: { type: String, enum: UPLOAD_STATUS, default: "pending" },
    multipartUploadId: { type: String },
    jobId: { type: String },
    seriesId: { type: Schema.Types.ObjectId, ref: "Series" },
    chapterMeta: { type: chapterMetaSchema },
    renderMode: { type: String, enum: RENDER_MODES },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// TTL: abandoned uploads are removed automatically (matches the R2 lifecycle rule).
uploadSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Upload: Model<IUpload> =
  (models.Upload as Model<IUpload>) ?? model<IUpload>("Upload", uploadSchema);
