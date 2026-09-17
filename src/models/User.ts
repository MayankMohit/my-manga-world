import { Schema, model, models, type Model, type Types } from "mongoose";
import {
  READING_MODES,
  DIRECTIONS,
  FITS,
  THEMES,
  USER_ROLES,
  type ReadingMode,
  type Direction,
  type Fit,
  type Theme,
  type UserRole,
} from "@/lib/shared/constants";

export interface UserSettings {
  readingMode: ReadingMode;
  direction: Direction;
  fit: Fit;
  theme: Theme;
  preloadCount: number;
}

export interface IUser {
  _id: Types.ObjectId;
  email: string;
  passwordHash: string;
  name?: string;
  tokenVersion: number;
  storageUsedBytes: number;
  role: UserRole;
  settings: UserSettings;
  createdAt: Date;
  updatedAt: Date;
}

const settingsSchema = new Schema<UserSettings>(
  {
    readingMode: { type: String, enum: READING_MODES, default: "vertical" },
    direction: { type: String, enum: DIRECTIONS, default: "rtl" },
    fit: { type: String, enum: FITS, default: "width" },
    theme: { type: String, enum: THEMES, default: "system" },
    preloadCount: { type: Number, default: 3, min: 0, max: 10 },
  },
  { _id: false },
);

const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: { type: String, required: true },
    name: { type: String, trim: true },
    tokenVersion: { type: Number, default: 0 },
    storageUsedBytes: { type: Number, default: 0, min: 0 },
    role: { type: String, enum: USER_ROLES, default: "user" },
    settings: { type: settingsSchema, default: () => ({}) },
  },
  { timestamps: true },
);

export const User: Model<IUser> =
  (models.User as Model<IUser>) ?? model<IUser>("User", userSchema);
