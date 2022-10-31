import { Document } from 'mongoose';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export type ConfigManagerDocument = ConfigManager & Document;

@Schema({ timestamps: true, autoIndex: true })
export class ConfigManager {
  @Prop({ required: true, uppercase: true })
  namespace: string;

  @Prop({ required: true, uppercase: true })
  configId: string;

  @Prop({ required: true })
  value: string;
}

export const ConfigManagerSchema = SchemaFactory.createForClass(ConfigManager);

ConfigManagerSchema.index({ namespace: 1, configId: 1 }, { unique: true });
