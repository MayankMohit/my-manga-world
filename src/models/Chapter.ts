import { Schema, model, models, type Model, type Types } from "mongoose";
import {
  CHAPTER_STATUS,
  SOURCE_FORMATS,
  RENDER_MODES,
  DOCUMENT_FORMATS,
  type ChapterStatus,
  type SourceFormat,
  type RenderMode,
  type DocumentFormat,
} from "@/lib/shared/constants";

export interface IChapter {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  seriesId: Types.ObjectId;
  number: number;
  title?: string;
  volume?: number;
  pageCount: number;
  status: ChapterStatus;
  error?: string;
  sourceFormat: SourceFormat;
  renderMode: RenderMode;
  documentKey?: string;
  documentFormat?: DocumentFormat;
  sizeBytes: number;
  jobId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const chapterSchema = new Schema<IChapter>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    seriesId: { type: Schema.Types.ObjectId, ref: "Series", required: true },
    number: { type: Number, required: true },
    title: { type: String, trim: true },
    volume: { type: Number },
    pageCount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: CHAPTER_STATUS, default: "queued" },
    error: { type: String },
    sourceFormat: { type: String, enum: SOURCE_FORMATS, required: true },
    renderMode: { type: String, enum: RENDER_MODES, default: "images" },
    documentKey: { type: String },
    documentFormat: { type: String, enum: DOCUMENT_FORMATS },
    sizeBytes: { type: Number, default: 0, min: 0 },
    jobId: { type: String, index: true },
  },
  { timestamps: true },
);

chapterSchema.index({ ownerId: 1, seriesId: 1, number: 1 });
chapterSchema.index({ ownerId: 1, status: 1 });

export const Chapter: Model<IChapter> =
  (models.Chapter as Model<IChapter>) ?? model<IChapter>("Chapter", chapterSchema);
