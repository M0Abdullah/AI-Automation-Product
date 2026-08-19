import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { RequireWrite } from '../auth/auth.guard';
import { RejectTestCaseDto, UpdateTestCaseDto } from './dto/update-test-case.dto';
import { TestCasesService } from './test-cases.service';

@Controller()
export class TestCasesController {
  constructor(private readonly cases: TestCasesService) {}

  @Get('test-cases/:id')
  findOne(@Param('id') id: string) {
    return this.cases.findOne(id);
  }

  /** Edit a generated test case. Re-validated against the policy engine. */
  @RequireWrite()
  @Patch('test-cases/:id')
  update(@Param('id') id: string, @Body() dto: UpdateTestCaseDto) {
    return this.cases.update(id, dto);
  }

  @RequireWrite()
  @Post('test-cases/:id/approve')
  approve(@Param('id') id: string) {
    return this.cases.approve(id);
  }

  @RequireWrite()
  @Post('test-cases/:id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectTestCaseDto) {
    return this.cases.reject(id, dto);
  }

  /** Re-run a single test - the "Ready for Retest" action. */
  @Post('test-cases/:id/retest')
  retest(@Param('id') id: string) {
    return this.cases.retest(id);
  }

  @RequireWrite()
  @Post('runs/:runId/test-cases/approve-all')
  approveAll(@Param('runId') runId: string) {
    return this.cases.approveAll(runId);
  }
}
