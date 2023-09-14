import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Inject, Injectable, Optional, UnprocessableEntityException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Queue } from 'bullmq';
import { catchError } from 'rxjs';

import { BULLMQ_REALMS_QUEUE, REDIS_PUBSUB } from '@/constants/app.constants';
import { ContentUpsertReq } from '@/dtos/content-upsert-req.dto';
import { RealmsUpsertReq } from '@/dtos/realms-upsert.dto.req';
import { convertEntitiesToRealmsUpsertReq } from '@/helpers/convert-entities-to-realms-upsert-req.helper';
import { mapDecryptedRealmsUpsert } from '@/helpers/map-decrypted-realms-upsert.helper';
import { mapEntitiesToContentFile } from '@/helpers/map-entities-to-content-file.helper';
import { reduceEntities } from '@/helpers/reduce-entities.helper';
import { reduceToRealms } from '@/helpers/reduce-to-realms.helper';
import { MQTT_CLIENT, MqttClient } from '@/modules/mqtt-client.module';
import { RealmRepository } from '@/repositories/realm.repository';

import { ConfigFactoryService } from './config-factory.service';
import { CryptoService } from './crypto.service';

@Injectable()
export class RealmService {
  constructor(
    private readonly configRepo: RealmRepository,
    private readonly factory: ConfigFactoryService,
    private readonly cryptoService: CryptoService,
    @Optional() @Inject(REDIS_PUBSUB) private readonly redisPubSubClient: ClientProxy,
    @Optional() @InjectQueue(BULLMQ_REALMS_QUEUE) private readonly bullmq: Queue,
    @Optional() @Inject(MQTT_CLIENT) private readonly mqttClient: MqttClient,
  ) {}

  async countRealmContents() {
    return await this.configRepo.countContents();
  }

  async countRealms() {
    return await this.configRepo.countRealms();
  }

  async upsertRealm(realm: string, reqs: Array<ContentUpsertReq>) {
    const payload = this.factory.app.crypto.cryptable ? this.cryptoService.encryptContentUpsertReqs(reqs) : reqs;
    const result = await this.configRepo.upsert(realm, payload);
    if (!result?.ok) throw new BadRequestException(result);
    this.redisPubSubClient?.emit(realm, reqs).pipe(catchError((error) => error));
    this.bullmq?.add(realm, reqs).catch((error) => error);
    this.mqttClient?.publish(realm, reqs);
    return result;
  }

  async upsertRealms(reqs: Array<RealmsUpsertReq>) {
    const payload = this.factory.app.crypto.cryptable ? this.cryptoService.encryptRealmsUpsertReq(reqs) : reqs;
    const result = await this.configRepo.upsertMany(payload);
    if (!result?.ok) throw new BadRequestException(result);
    if (this.redisPubSubClient || this.mqttClient)
      reqs.forEach(({ realm, contents }) => {
        this.redisPubSubClient?.emit(realm, contents).pipe(catchError((error) => error));
        this.mqttClient?.publish(realm, contents);
      });
    this.bullmq?.addBulk(reqs.map(({ realm, contents }) => ({ name: realm, data: contents }))).catch((error) => error);
    return result;
  }

  // TODO: decrypt
  async getRealms(realms: Array<string>) {
    const realmSet = Array.from(new Set(realms.map((space) => space.trim())));
    const entities = await this.configRepo.where({ realm: { $in: realmSet } });
    return entities?.reduce((acc, val) => reduceToRealms(acc, val, this.factory.app.realm.resolveEnv), {});
  }

  // TODO: decrypt
  async getRealm(realm: string) {
    return await this.configRepo.where({ realm });
  }

  // TODO: decrypt, rename
  async getRealmConfigIds(realm: string, ids: Array<string>) {
    const entities = await this.configRepo.where({
      realm,
      id: { $in: ids },
    });

    if (entities?.length < ids?.length)
      throw new UnprocessableEntityException(
        `N/A [ realm: ${realm} | id: ${ids.filter((id) => !entities.find(({ _id }) => _id === id))} ]`,
      );

    return reduceEntities(this.factory.app.realm.resolveEnv, entities);
  }

  async deleteRealm(realm: string) {
    const entity = await this.configRepo.delete(realm);
    if (!entity.deletedCount) return entity;
    this.redisPubSubClient?.emit(realm, null).pipe(catchError((error) => error));
    this.bullmq?.add(realm, null).catch((error) => error);
    this.mqttClient?.publish(realm, null);
    return entity;
  }

  // TODO: rename
  async deleteRealmConfigIds(realm: string, ids: Array<string>) {
    const entity = await this.configRepo.delete(realm, ids);
    if (!entity.deletedCount) return entity;
    this.redisPubSubClient?.emit(realm, ids).pipe(catchError((error) => error));
    this.bullmq?.add(realm, ids).catch((error) => error);
    this.mqttClient?.publish(realm, ids);
    return entity;
  }

  // TODO: rename, decrypt?
  async downloadConfigFile(realms?: Array<string>) {
    if (!realms) {
      const entities = await this.configRepo.findAll();
      const realms = Array.from(new Set(entities.map(({ realm }) => realm)));
      if (!this.factory.app.crypto.cryptable) return mapEntitiesToContentFile(entities, realms);
      const converted = convertEntitiesToRealmsUpsertReq(entities, realms);
      const decrypted = this.cryptoService.decryptRealmsUpsertReq(converted);
      return mapDecryptedRealmsUpsert(decrypted);
    }

    const realmSet = Array.from(new Set(realms.map((space) => space.trim())));
    const entities = await this.configRepo.where({ realm: { $in: realmSet } });
    if (!this.factory.app.crypto.cryptable) return mapEntitiesToContentFile(entities, realmSet);
    const converted = convertEntitiesToRealmsUpsertReq(entities, realms);
    const decrypted = this.cryptoService.decryptRealmsUpsertReq(converted);
    return mapDecryptedRealmsUpsert(decrypted);
  }
}
