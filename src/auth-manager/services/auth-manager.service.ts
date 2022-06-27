import { hash, verify } from 'argon2';
import { Cache } from 'cache-manager';
import {
  CACHE_MANAGER,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigManagerApi } from '../api/config-manager.api';
import { ConfigFactoryService } from '../configs/config-factory.service';
import { Role } from '../constants/role.enum';
import { AuthManagerSigninReq } from '../dtos/auth-manager-signin-req.dto';
import { AuthManagerSignupReq } from '../dtos/auth-manager-signup-req.dto';
import { AuthManagerToken } from '../dtos/auth-manager-token.dto';
import { AuthManagerUserRepository } from './auth-manager-user.repository';

@Injectable()
export class AuthManagerService {
  constructor(
    private readonly userRepo: AuthManagerUserRepository,
    private readonly jwtService: JwtService,
    private readonly configManagerApi: ConfigManagerApi,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly configFactory: ConfigFactoryService,
  ) {}

  async signup(req: AuthManagerSignupReq) {
    try {
      return await this.userRepo.findOneAndUpdate(req);
    } catch (error) {
      throw new ForbiddenException('email/username already exist');
    }
  }

  async signin(
    req: AuthManagerSigninReq,
    refServiceId?: string,
    refConfigIds?: string[],
  ) {
    const result = await this.challengeOptionalConfigs(
      refServiceId,
      refConfigIds,
    );

    const user = await this.userRepo.findOne(req);

    if (!user || !(await verify(user.hash, req.password)))
      throw new ForbiddenException('username/password does not match');

    return this.signAccessRefreshToken({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      configs: refServiceId && result,
    });
  }

  async token(
    serviceId: string,
    refServiceId?: string,
    refConfigIds?: string[],
    data?: Record<string, any>,
  ) {
    const config = this.configFactory.authManager;
    const configs = await this.challengeOptionalConfigs(
      refServiceId,
      refConfigIds,
    );

    const CONSUMER_TOKEN = this.jwtService.sign(
      {
        serviceId,
        role: Role.consumer,
        ...(Object.keys(data)?.length && { data }),
        configs,
      },
      { secret: config.tokenSecret },
    );

    return { CONSUMER_TOKEN };
  }

  async refresh(rawToken: string, token: AuthManagerToken) {
    const cache: any = await this.cacheManager.get(token.id);
    if (cache?.AUTH_HASH && (await verify(cache?.AUTH_HASH, rawToken)))
      return this.signAccessRefreshToken(token);
    throw new UnauthorizedException();
  }

  logout(token: AuthManagerToken) {
    return this.cacheManager.del(token.id);
  }

  challengeOptionalConfigs(refServiceId?: string, refConfigIds?: string[]) {
    if (refServiceId && refConfigIds?.length)
      return this.configManagerApi.getConfigIds(refServiceId, refConfigIds);
    if (refServiceId) return this.configManagerApi.getServiceId(refServiceId);
  }

  async signAccessRefreshToken(token: Omit<AuthManagerToken, 'iat' | 'exp'>) {
    const config = this.configFactory.authManager;
    const ACCESS_TOKEN = this.jwtService.sign(token, {
      expiresIn: config.accessTokenTTL,
      secret: config.tokenSecret,
    });

    const REFRESH_TOKEN = this.jwtService.sign(token, {
      expiresIn: config.refreshTokenTTL,
      secret: config.tokenSecret,
    });

    await this.cacheManager.set(
      token.id,
      { AUTH_HASH: await hash(ACCESS_TOKEN) },
      { ttl: config.accessTokenTTL },
    );

    return { ACCESS_TOKEN, REFRESH_TOKEN };
  }
}
