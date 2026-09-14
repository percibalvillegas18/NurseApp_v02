import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ContractsService } from './contracts.service';
import { ContractAlertsService } from './contract-alerts.service';
import {
  CreateContractDto,
  UpdateContractDto,
  TerminateContractDto,
  RenewContractDto,
  AddContractDocumentDto,
} from './dto/contracts.dto';
import {
  CanView,
  CanCreate,
  CanEdit,
  RequirePermission,
} from '../../common/decorators/require-permission.decorator';
import { RbacGuard } from '../../common/guards/rbac.guard';

@Controller('contracts')
@UseGuards(AuthGuard('jwt'), RbacGuard)
export class ContractsController {
  constructor(
    private contracts: ContractsService,
    private alerts: ContractAlertsService,
  ) {}

  @Get('agencies')
  @CanView('CONTRACT')
  async agencies() {
    const data = await this.contracts.listAgencies();
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Get('positions')
  @CanView('CONTRACT')
  async positions() {
    const data = await this.contracts.listPositions();
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Get('positions/hierarchy')
  @CanView('CONTRACT')
  async positionHierarchy() {
    const data = await this.contracts.listPositionHierarchy();
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Get('expiring')
  @CanView('CONTRACT')
  async expiring(@Query('days') days?: string) {
    const data = await this.contracts.listExpiring(days ? parseInt(days, 10) : 90);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Get('alerts/summary')
  @CanView('CONTRACT')
  async alertsSummary() {
    const data = await this.alerts.summary();
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Get('alerts')
  @CanView('CONTRACT')
  async listAlerts(
    @Query('acknowledged') acknowledged?: string,
    @Query('severity') severity?: string,
    @Query('alertType') alertType?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
  ) {
    let ack: boolean | undefined;
    if (acknowledged === 'true') ack = true;
    if (acknowledged === 'false') ack = false;
    const data = await this.alerts.listAlerts({
      acknowledged: ack,
      severity,
      alertType,
      page,
      limit,
    });
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post('alerts/scan')
  @RequirePermission({ menuCode: 'CONTRACT', permissionCode: 'APPROVE' })
  async runAlertScan(@Req() req: any) {
    const data = await this.alerts.runExpiryScan(req.user?.id);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post('alerts/:id/acknowledge')
  @CanEdit('CONTRACT')
  async acknowledgeAlert(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const data = await this.alerts.acknowledge(id, req.user.id);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Get()
  @CanView('CONTRACT')
  async list(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('agencyId') agencyId?: string,
    @Query('nurseId') nurseId?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    const data = await this.contracts.list({
      search,
      status,
      agencyId: agencyId ? parseInt(agencyId, 10) : undefined,
      nurseId: nurseId ? parseInt(nurseId, 10) : undefined,
      page,
      limit,
    });
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Get(':id')
  @CanView('CONTRACT')
  async get(@Param('id', ParseIntPipe) id: number) {
    const data = await this.contracts.getById(id);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Get(':id/history')
  @CanView('CONTRACT')
  async history(@Param('id', ParseIntPipe) id: number) {
    const data = await this.contracts.history(id);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Get(':id/documents')
  @CanView('CONTRACT')
  async documents(@Param('id', ParseIntPipe) id: number) {
    const data = await this.contracts.listDocuments(id);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post()
  @CanCreate('CONTRACT')
  async create(@Body() dto: CreateContractDto, @Req() req: any) {
    const data = await this.contracts.create(dto, req.user.id);
    return { success: true, statusCode: 201, data, timestamp: new Date().toISOString() };
  }

  @Patch(':id')
  @CanEdit('CONTRACT')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateContractDto,
    @Req() req: any,
  ) {
    const data = await this.contracts.update(id, dto, req.user.id);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post(':id/submit')
  @CanEdit('CONTRACT')
  async submit(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const data = await this.contracts.submit(id, req.user.id);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post(':id/approve')
  @RequirePermission({ menuCode: 'CONTRACT', permissionCode: 'APPROVE' })
  async approve(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const data = await this.contracts.approve(id, req.user.id);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post(':id/activate')
  @RequirePermission({ menuCode: 'CONTRACT', permissionCode: 'APPROVE' })
  async activate(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const data = await this.contracts.activate(id, req.user.id);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post(':id/suspend')
  @CanEdit('CONTRACT')
  async suspend(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { reason?: string },
    @Req() req: any,
  ) {
    const data = await this.contracts.suspend(id, req.user.id, body?.reason);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post(':id/terminate')
  @CanEdit('CONTRACT')
  async terminate(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TerminateContractDto,
    @Req() req: any,
  ) {
    const data = await this.contracts.terminate(id, dto, req.user.id);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post(':id/renew')
  @CanCreate('CONTRACT')
  async renew(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RenewContractDto,
    @Req() req: any,
  ) {
    const data = await this.contracts.renew(id, dto, req.user.id);
    return { success: true, statusCode: 201, data, timestamp: new Date().toISOString() };
  }

  @Post(':id/documents')
  @CanEdit('CONTRACT')
  async addDocument(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddContractDocumentDto,
    @Req() req: any,
  ) {
    const data = await this.contracts.addDocument(id, dto, req.user.id);
    return { success: true, statusCode: 201, data, timestamp: new Date().toISOString() };
  }
}
